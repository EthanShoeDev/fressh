import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { type CommandResult, disconnect } from '@fressh/react-native-terminal';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import * as Str from 'effect/String';
import React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/themed/button';
import { ThemedText } from '@/components/themed/themed-text';
import { usePresets } from '@/lib/presets';
import { runCommandOneOffAtom, type OneOffConnection } from '@/lib/query-fns';
import { appRuntime } from '@/lib/runtime';
import type { InputConnectionDetails } from '@/lib/secrets-manager';
import { useThemeSkin } from '@/lib/theme-skin';
import { asyncResultErrorMessage } from '@/lib/utils';

/**
 * Run a one-off command on a saved host without a persistent shell. Reuses a live
 * connection if one exists, otherwise connects fresh (and disconnects it when the
 * sheet closes — we only tear down what we opened). The command runs on a no-PTY
 * `exec` channel in the login/home dir. See preset-command-buttons.md.
 */
export function RunCommandSheet({
  details,
  title,
  onClose,
}: {
  details: InputConnectionDetails;
  title: string;
  onClose: () => void;
}) {
  const skin = useThemeSkin();
  const primary = useCSSVariable('--color-primary') as string;
  const border = useCSSVariable('--color-border') as string;
  const surface = useCSSVariable('--color-surface') as string;
  const presets = usePresets();
  const mono =
    skin.mono && skin.monoFamily !== undefined && skin.monoFamily !== ''
      ? { fontFamily: skin.monoFamily }
      : undefined;

  const [command, setCommand] = React.useState('');
  // 'connecting' vs 'running' while the mutation is pending (the atom reports
  // it via onPhase — pending/result/failure come from the atom itself).
  const [phase, setPhase] = React.useState<'connecting' | 'running'>(
    'connecting',
  );
  // The connection we're using; `fresh` = we opened it, so disconnect on unmount.
  const [conn, setConn] = React.useState<OneOffConnection | null>(null);

  const runState = useAtomValue(runCommandOneOffAtom);
  const triggerRun = useAtomSet(runCommandOneOffAtom);

  const running = runState.waiting;
  const result =
    !running && AsyncResult.isSuccess(runState) ? runState.value : null;
  const error = !running ? asyncResultErrorMessage(runState) : null;

  // Tear down a fresh connection when the sheet goes away (ref so the unmount
  // cleanup sees the latest connection, not a stale closure).
  const connRef = React.useRef(conn);
  React.useEffect(() => {
    connRef.current = conn;
  }, [conn]);
  React.useEffect(
    () => () => {
      const c = connRef.current;
      if (c?.fresh === true) {
        appRuntime.runFork(
          Effect.ignore(Effect.tryPromise(() => disconnect(c.connectionId))),
        );
      }
    },
    [],
  );

  const run = () => {
    const cmd = Str.trim(command);
    if (!cmd || running) {
      return;
    }
    triggerRun({
      details,
      command: cmd,
      conn,
      onPhase: setPhase,
      onConnection: setConn,
    });
  };

  return (
    <BottomSheet onClose={onClose} maxHeightPct={88}>
      <View className='gap-3 p-5'>
        <View>
          <ThemedText className='text-text-primary text-lg font-bold'>
            Run on {title}
          </ThemedText>
          <ThemedText className='mt-1 text-xs text-muted'>
            Connects if needed (disconnects on close), runs in your home
            directory — no shell. Use “cd … &&” for a different folder.
          </ThemedText>
        </View>

        <TextInput
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet opens to type a command; focusing the field on open is the intended UX
          autoFocus
          value={command}
          onChangeText={setCommand}
          placeholder='e.g. df -h'
          placeholderTextColorClassName='accent-muted'
          autoCapitalize='none'
          autoCorrect={false}
          onSubmitEditing={run}
          className='text-text-primary px-3.5 py-3 text-base'
          style={[
            {
              borderWidth: 1.5,
              borderColor: primary,
              borderRadius: skin.controlRadius,
              backgroundColor: 'rgba(0,0,0,0.25)',
            },
            mono,
          ]}
        />

        {presets.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 7 }}
          >
            {Arr.map(presets, (p) => (
              <Pressable
                key={p.id}
                onPress={() => setCommand(p.command)}
                className='px-3 py-1.5'
                style={{
                  borderRadius: skin.controlRadius,
                  borderWidth: 1,
                  borderColor: border,
                  backgroundColor: surface,
                }}
              >
                <ThemedText className='text-text-primary text-xs font-semibold'>
                  {p.label}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <Button
          title='Run'
          loading={running}
          loadingTitle={phase === 'connecting' ? 'Connecting…' : 'Running…'}
          disabled={Str.trim(command).length === 0}
          onPress={run}
        />

        {error !== null && error !== '' ? (
          <ThemedText className='text-danger text-sm' style={mono}>
            {error}
          </ThemedText>
        ) : null}

        {result ? <ResultView result={result} mono={mono} /> : null}
      </View>
    </BottomSheet>
  );
}

function ResultView({
  result,
  mono,
}: {
  result: CommandResult;
  mono: { fontFamily: string } | undefined;
}) {
  const code = result.exitCode;
  return (
    <View className='gap-2'>
      <View className='flex-row items-center gap-2'>
        {code === undefined ? (
          <ThemedText className='text-xs font-bold text-muted'>
            signal / no exit code
          </ThemedText>
        ) : code === 0 ? (
          <ThemedText className='text-success text-xs font-bold'>
            ✓ exit 0
          </ThemedText>
        ) : (
          <ThemedText className='text-danger text-xs font-bold'>
            ✗ exit {code}
          </ThemedText>
        )}
      </View>
      <ScrollView
        style={{ maxHeight: 320 }}
        className='rounded-lg border border-border bg-background p-3'
      >
        {result.stdout ? (
          <ThemedText className='text-text-primary text-[13px]' style={mono}>
            {result.stdout}
          </ThemedText>
        ) : null}
        {result.stderr ? (
          <ThemedText className='text-danger mt-1 text-[13px]' style={mono}>
            {result.stderr}
          </ThemedText>
        ) : null}
        {!result.stdout && !result.stderr ? (
          <ThemedText className='text-[13px] text-muted'>
            (no output)
          </ThemedText>
        ) : null}
      </ScrollView>
    </View>
  );
}
