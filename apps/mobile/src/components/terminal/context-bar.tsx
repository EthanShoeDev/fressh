import { FontAwesome6 } from '@expo/vector-icons';
import * as Arr from 'effect/Array';
import * as Str from 'effect/String';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { BottomSheet } from '@/components/bottom-sheet';
import { ThemedText } from '@/components/themed/themed-text';
import type { GitStatus } from '@/lib/git-status';
import { preferences } from '@/lib/preferences';
import {
  type RecentCommand,
  type ShellContext,
  useShellContext,
} from '@/lib/terminal-semantics';
import { useThemeSkin } from '@/lib/theme-skin';
import { useGitStatusDriver } from '@/lib/use-git-status';

/**
 * The "smart terminal" context bar — a thin always-visible row under the app bar
 * showing the live shell context (cwd, command status, exit code, timing). Tap it
 * for a details sheet (recent commands + the integration state). Supersedes the
 * temporary debug panel; the ambient home the git badge slots into next.
 *
 * See docs/projects/smart-terminal-surface.md.
 */
export function ContextBar({ shellId }: { shellId: string }) {
  useGitStatusDriver(shellId);
  const ctx = useShellContext(shellId);
  const [globalOn] = preferences.shellIntegrationEnabled.useValue();
  const skin = useThemeSkin();
  const mutedColor = useCSSVariable('--color-muted') as string;
  const primaryColor = useCSSVariable('--color-primary') as string;
  const monoFamily = skin.mono ? skin.monoFamily : undefined;
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  // Global kill-switch off ⇒ behave like a plain client; no bar at all.
  if (!globalOn) {
    return null;
  }

  return (
    <>
      <Pressable
        accessibilityLabel='Smart terminal details'
        onPress={() => setDetailsOpen(true)}
        className='bg-surface flex-row items-center gap-2 border-b border-border px-3 py-1.5'
      >
        {ctx?.sawOsc === true ? (
          <ActiveContent
            ctx={ctx}
            monoFamily={monoFamily}
            primaryColor={primaryColor}
            mutedColor={mutedColor}
          />
        ) : (
          <>
            <FontAwesome6 name='circle-notch' size={11} color={mutedColor} />
            <ThemedText className='flex-1 text-xs text-muted' numberOfLines={1}>
              Waiting for shell integration…
            </ThemedText>
          </>
        )}
        <FontAwesome6 name='chevron-up' size={9} color={mutedColor} />
      </Pressable>

      {detailsOpen ? (
        <DetailsSheet
          ctx={ctx}
          monoFamily={monoFamily}
          shellId={shellId}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null}
    </>
  );
}

function ActiveContent({
  ctx,
  monoFamily,
  primaryColor,
  mutedColor,
}: {
  ctx: ShellContext;
  monoFamily: string | undefined;
  primaryColor: string;
  mutedColor: string;
}) {
  return (
    <>
      <FontAwesome6 name='folder' size={11} color={primaryColor} />
      <ThemedText
        className='text-text-primary shrink text-xs font-semibold'
        numberOfLines={1}
        style={
          monoFamily !== undefined && monoFamily !== ''
            ? { fontFamily: monoFamily }
            : undefined
        }
      >
        {ctx.cwd !== undefined && ctx.cwd !== '' ? basename(ctx.cwd) : '—'}
      </ThemedText>

      {ctx.git ? <GitBadge git={ctx.git} mutedColor={mutedColor} /> : null}

      <View className='flex-1' />

      {ctx.running ? (
        <View className='flex-row items-center gap-1.5'>
          <ActivityIndicator size='small' color={primaryColor} />
          <ThemedText
            className='text-xs text-muted'
            numberOfLines={1}
            style={{ maxWidth: 150 }}
          >
            {ctx.lastCommand ?? 'running…'}
          </ThemedText>
        </View>
      ) : ctx.commandCount > 0 ? (
        <View className='flex-row items-center gap-2'>
          <ExitBadge code={ctx.lastExitCode} />
          {ctx.lastDurationMs !== undefined ? (
            <ThemedText className='text-[11px] text-muted'>
              {formatDuration(ctx.lastDurationMs)}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function DetailsSheet({
  ctx,
  monoFamily,
  shellId,
  onClose,
}: {
  ctx: ShellContext | undefined;
  monoFamily: string | undefined;
  shellId: string;
  onClose: () => void;
}) {
  const mono =
    monoFamily !== undefined && monoFamily !== ''
      ? { fontFamily: monoFamily }
      : undefined;
  const recent = ctx?.recent ?? [];
  return (
    <BottomSheet onClose={onClose} maxHeightPct={70}>
      <View className='gap-4 p-5'>
        <ThemedText className='text-text-primary text-lg font-bold'>
          Smart terminal
        </ThemedText>

        <View className='gap-1'>
          <ThemedText className='text-xs font-semibold text-muted uppercase'>
            Working directory
          </ThemedText>
          <ThemedText
            className='text-text-primary text-sm'
            numberOfLines={1}
            style={mono}
          >
            {ctx?.cwd ?? '—'}
          </ThemedText>
        </View>

        {ctx?.git ? (
          <GitSection
            git={ctx.git}
            mono={mono}
            shellId={shellId}
            onClose={onClose}
          />
        ) : null}

        <View className='gap-1'>
          <ThemedText className='text-xs font-semibold text-muted uppercase'>
            Recent commands
          </ThemedText>
          {recent.length === 0 ? (
            <ThemedText className='text-sm text-muted'>
              {ctx?.sawOsc === true
                ? 'No commands yet.'
                : 'Waiting for shell integration. Toggle it in Settings → Shell integration, or per host on the server screen.'}
            </ThemedText>
          ) : (
            <ScrollView style={{ maxHeight: 280 }}>
              <View className='gap-1.5'>
                {Arr.map(recent, (cmd, i) => (
                  <RecentRow key={`${cmd.atMs}-${i}`} cmd={cmd} mono={mono} />
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}

function RecentRow({
  cmd,
  mono,
}: {
  cmd: RecentCommand;
  mono: { fontFamily: string } | undefined;
}) {
  return (
    <View className='flex-row items-center gap-2 border-b border-border py-1.5'>
      <ExitBadge code={cmd.exitCode} />
      <ThemedText
        className='text-text-primary flex-1 text-sm'
        numberOfLines={1}
        style={mono}
      >
        {cmd.command ?? '(command)'}
      </ThemedText>
      {cmd.durationMs !== undefined ? (
        <ThemedText className='text-[11px] text-muted'>
          {formatDuration(cmd.durationMs)}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Debug-grade git readout for the details sheet: branch/upstream/sync, counts, and
 *  the changed-file list with raw XY codes. The honest "is detection working" view;
 *  the richer files UI + diff peek land later. */
function GitSection({
  git,
  mono,
  shellId,
  onClose,
}: {
  git: GitStatus;
  mono: { fontFamily: string } | undefined;
  shellId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const openDiff = (file: string, untracked: boolean) => {
    onClose();
    router.push({
      pathname: '/servers/diff',
      params: { shellId, file, untracked: untracked ? '1' : '0' },
    });
  };
  return (
    <View className='gap-1'>
      <ThemedText className='text-xs font-semibold text-muted uppercase'>
        Git
      </ThemedText>
      <ThemedText className='text-text-primary text-sm' style={mono}>
        {git.detached ? '(detached)' : (git.branch ?? '—')}
        {git.upstream !== undefined && git.upstream !== ''
          ? ` → ${git.upstream}`
          : ''}
        {git.ahead > 0 ? `  ↑${git.ahead}` : ''}
        {git.behind > 0 ? `  ↓${git.behind}` : ''}
      </ThemedText>
      <ThemedText className='text-xs text-muted'>
        {git.staged} staged · {git.unstaged} unstaged · {git.untracked}{' '}
        untracked
        {git.conflicted > 0 ? ` · ${git.conflicted} conflicted` : ''}
      </ThemedText>
      {git.files.length > 0 ? (
        <ScrollView style={{ maxHeight: 200 }}>
          <View className='gap-0.5'>
            {Arr.map(git.files, (f) => (
              <Pressable
                key={`${f.kind}-${f.path}`}
                onPress={() => openDiff(f.path, f.kind === 'untracked')}
                className='flex-row items-center gap-2 py-0.5 active:opacity-60'
              >
                <ThemedText className='text-xs text-muted' style={mono}>
                  {f.kind === 'untracked' ? '??' : `${f.x}${f.y}`}
                </ThemedText>
                <ThemedText
                  className='text-text-primary flex-1 text-xs'
                  numberOfLines={1}
                  style={mono}
                >
                  {f.origPath !== undefined && f.origPath !== ''
                    ? `${f.origPath} → ${f.path}`
                    : f.path}
                </ThemedText>
                <FontAwesome6 name='chevron-right' size={9} color='#888' />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ThemedText className='text-sm text-muted'>
          Working tree clean.
        </ThemedText>
      )}
    </View>
  );
}

/** Compact branch + sync + dirty-count chip: `⎇ main ↑2 ↓1 ●5`. Hidden when cwd is
 *  not a repo (the driver leaves `git` undefined). */
function GitBadge({ git, mutedColor }: { git: GitStatus; mutedColor: string }) {
  const dirty = git.staged + git.unstaged + git.untracked + git.conflicted;
  return (
    <View className='flex-row items-center gap-1'>
      <FontAwesome6 name='code-branch' size={10} color={mutedColor} />
      <ThemedText
        className='text-xs text-muted'
        numberOfLines={1}
        style={{ maxWidth: 90 }}
      >
        {git.detached ? '(detached)' : (git.branch ?? '—')}
      </ThemedText>
      {git.ahead > 0 ? (
        <ThemedText className='text-[11px] text-muted'>↑{git.ahead}</ThemedText>
      ) : null}
      {git.behind > 0 ? (
        <ThemedText className='text-[11px] text-muted'>
          ↓{git.behind}
        </ThemedText>
      ) : null}
      {dirty > 0 ? (
        <ThemedText className='text-warning text-[11px] font-semibold'>
          ●{dirty}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** ✓ (green) for exit 0, ✗N (red) for non-zero, nothing when the shell omitted it. */
function ExitBadge({ code }: { code: number | undefined }) {
  if (code === undefined) {
    return null;
  }
  return code === 0 ? (
    <ThemedText className='text-success text-xs font-bold'>✓</ThemedText>
  ) : (
    <ThemedText className='text-danger text-xs font-bold'>✗{code}</ThemedText>
  );
}

/** Last path segment of an absolute cwd (`/home/ethan/proj` → `proj`). */
function basename(cwd: string) {
  // TODO: Should we or could we use the effect-ts Path module to do this? (maybe not, it might require bun or node)
  const parts = Arr.filter(Str.split(cwd, '/'), Str.isNonEmpty);
  return parts.at(-1) ?? '/';
}

/** Compact human duration: `340ms` · `1.2s` · `1m2s`. */
function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  }
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}
