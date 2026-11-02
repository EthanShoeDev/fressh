import { useAtomValue } from '@effect/atom-react';
import { runCommand } from '@fressh/react-native-terminal';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Match from 'effect/Match';
import * as Str from 'effect/String';
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed/themed-text';
import {
  classifyDiffLine,
  type DiffLineKind,
  gitDiffCommand,
} from '@/lib/git-diff';
import { appRuntime } from '@/lib/runtime';
import { sshShellsAtom, type StoreShell } from '@/lib/ssh-store';
import { useShellContext } from '@/lib/terminal-semantics';
import { useThemeSkin } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/use-bottom-tab-spacing';

/** Cap rendered lines — a huge diff would build thousands of <Text> nodes. */
const LINE_CAP = 3000;

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ok'; lines: string[]; truncated: boolean };

/**
 * The diff route: a full screen showing `git diff` for one changed file, run
 * out-of-band on the shell's connection. Reached by tapping a file in the context
 * bar's git readout. Plain monospace + +/- colouring for now (the "debug route"
 * quality agreed for v2); richer rendering later.
 *
 * See docs/projects/git-diff-integration.md.
 */
export default function GitDiffScreen() {
  const params = useLocalSearchParams<{
    shellId: string;
    file: string;
    untracked?: string;
  }>();
  const { shellId, file } = params;
  const untracked = params.untracked === '1';

  const connectionId = useAtomValue(
    sshShellsAtom,
    React.useCallback(
      (shells: Record<string, StoreShell>) => shells[shellId]?.connectionId,
      [shellId],
    ),
  );
  const cwd = useShellContext(shellId)?.cwd;
  const skin = useThemeSkin();
  const monoFamily = skin.mono ? skin.monoFamily : undefined;
  const mono =
    monoFamily !== undefined && monoFamily !== ''
      ? { fontFamily: monoFamily }
      : undefined;
  const bottomSpace = useBottomTabSpacing();

  const unavailable =
    connectionId === undefined ||
    connectionId === '' ||
    cwd === undefined ||
    cwd === '';
  // Results are tagged with the request they answer, so a dep change reads as
  // `loading` during render instead of resetting state inside the effect.
  const requestKey = JSON.stringify([connectionId, cwd, file, untracked]);
  const [result, setResult] = React.useState<{
    key: string;
    state: State;
  } | null>(null);
  const state: State = unavailable
    ? { kind: 'error', message: 'Session no longer available.' }
    : result?.key === requestKey
      ? result.state
      : { kind: 'loading' };

  React.useEffect(() => {
    if (
      connectionId === undefined ||
      connectionId === '' ||
      cwd === undefined ||
      cwd === ''
    ) {
      return;
    }
    const key = JSON.stringify([connectionId, cwd, file, untracked]);
    const setState = (next: State) => setResult({ key, state: next });
    const command = gitDiffCommand(cwd, file, { untracked });
    // Fire-and-forget fiber: it handles its own errors (Effect.catch below),
    // and unmount/dep-change cancellation is interruption — an interrupted
    // fiber never reaches the setState calls.
    const fiber = appRuntime.runFork(
      Effect.gen(function* () {
        const res = yield* Effect.tryPromise(() =>
          runCommand(connectionId, command),
        );
        yield* Effect.sync(() => {
          // `--no-index` (untracked) exits 1 when a diff exists — that's success
          // here, so only treat a non-zero exit as an error for tracked files.
          if (!untracked && res.exitCode !== 0) {
            setState({
              kind: 'error',
              message:
                Str.trim(res.stderr) || `git diff exited ${res.exitCode}`,
            });
            return;
          }
          const text = Str.replace(/\n$/, '')(res.stdout);
          if (!text) {
            setState({ kind: 'empty' });
            return;
          }
          const all = Str.split(text, '\n');
          setState({
            kind: 'ok',
            lines: all.slice(0, LINE_CAP),
            truncated: all.length > LINE_CAP,
          });
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning('git diff failed', file, error);
            yield* Effect.sync(() =>
              // Show the underlying failure, not the UnknownError wrapper.
              setState({ kind: 'error', message: String(error.cause) }),
            );
          }),
        ),
        Effect.annotateLogs({ module: 'GitDiff' }),
      ),
    );
    return () => {
      appRuntime.runFork(Fiber.interrupt(fiber));
    };
  }, [connectionId, cwd, file, untracked]);

  return (
    <View className='flex-1 bg-background'>
      <Stack.Screen options={{ title: basename(file) }} />

      <View className='bg-surface border-b border-border px-3 py-1.5'>
        <ThemedText
          className='text-xs text-muted'
          numberOfLines={1}
          style={mono}
        >
          {file}
        </ThemedText>
      </View>

      {Match.value(state).pipe(
        Match.discriminatorsExhaustive('kind')({
          loading: () => (
            <View className='flex-1 items-center justify-center'>
              <ActivityIndicator />
            </View>
          ),
          error: (s) => (
            <View className='flex-1 items-center justify-center px-6'>
              <ThemedText
                className='text-danger text-center text-sm'
                style={mono}
              >
                {s.message}
              </ThemedText>
            </View>
          ),
          empty: () => (
            <View className='flex-1 items-center justify-center'>
              <ThemedText className='text-sm text-muted'>
                No changes to show.
              </ThemedText>
            </View>
          ),
          ok: (s) => (
            <ScrollView
              className='flex-1'
              contentContainerStyle={{ paddingBottom: bottomSpace }}
            >
              <ScrollView
                horizontal
                contentContainerStyle={{ paddingVertical: 8 }}
              >
                <View className='px-3'>
                  {Arr.map(s.lines, (line, i) => (
                    <DiffLine key={i} line={line} mono={mono} />
                  ))}
                  {s.truncated ? (
                    <ThemedText
                      className='py-2 text-xs text-muted'
                      style={mono}
                    >
                      … diff truncated at {LINE_CAP} lines
                    </ThemedText>
                  ) : null}
                </View>
              </ScrollView>
            </ScrollView>
          ),
        }),
      )}
    </View>
  );
}

const KIND_CLASS: Record<DiffLineKind, string> = {
  add: 'text-success',
  del: 'text-danger',
  hunk: 'text-primary',
  meta: 'text-muted',
  context: 'text-text-primary',
};

function DiffLine({
  line,
  mono,
}: {
  line: string;
  mono: { fontFamily: string } | undefined;
}) {
  return (
    <ThemedText
      className={`text-xs leading-5 ${KIND_CLASS[classifyDiffLine(line)]}`}
      style={mono}
    >
      {line === '' ? ' ' : line}
    </ThemedText>
  );
}

/** Last path segment (`src/lib/git.ts` → `git.ts`). */
function basename(path: string) {
  const parts = Arr.filter(Str.split(path, '/'), Str.isNonEmpty);
  return parts.at(-1) ?? path;
}
