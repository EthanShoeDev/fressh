import { FontAwesome6 } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { BottomSheet } from '@/components/BottomSheet';
import { ThemedText } from '@/components/themed/ThemedText';
import { preferences } from '@/lib/preferences';
import {
	type RecentCommand,
	type ShellContext,
	useShellContext,
} from '@/lib/terminal-semantics';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * The "smart terminal" context bar — a thin always-visible row under the app bar
 * showing the live shell context (cwd, command status, exit code, timing). Tap it
 * for a details sheet (recent commands + the integration state). Supersedes the
 * temporary debug panel; the ambient home the git badge slots into next.
 *
 * See docs/projects/smart-terminal-surface.md.
 */
export function ContextBar({ shellId }: { shellId: string }) {
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
				className='flex-row items-center gap-2 border-b border-border bg-surface px-3 py-1.5'
			>
				{ctx?.sawOsc ? (
					<ActiveContent
						ctx={ctx}
						monoFamily={monoFamily}
						primaryColor={primaryColor}
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
}: {
	ctx: ShellContext;
	monoFamily: string | undefined;
	primaryColor: string;
}) {
	return (
		<>
			<FontAwesome6 name='folder' size={11} color={primaryColor} />
			<ThemedText
				className='shrink text-xs font-semibold text-text-primary'
				numberOfLines={1}
				style={monoFamily ? { fontFamily: monoFamily } : undefined}
			>
				{ctx.cwd ? basename(ctx.cwd) : '—'}
			</ThemedText>

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
	onClose,
}: {
	ctx: ShellContext | undefined;
	monoFamily: string | undefined;
	onClose: () => void;
}) {
	const mono = monoFamily ? { fontFamily: monoFamily } : undefined;
	const recent = ctx?.recent ?? [];
	return (
		<BottomSheet onClose={onClose} maxHeightPct={70}>
			<View className='gap-4 p-5'>
				<ThemedText className='text-lg font-bold text-text-primary'>
					Smart terminal
				</ThemedText>

				<View className='gap-1'>
					<ThemedText className='text-xs font-semibold uppercase text-muted'>
						Working directory
					</ThemedText>
					<ThemedText
						className='text-sm text-text-primary'
						numberOfLines={1}
						style={mono}
					>
						{ctx?.cwd ?? '—'}
					</ThemedText>
				</View>

				<View className='gap-1'>
					<ThemedText className='text-xs font-semibold uppercase text-muted'>
						Recent commands
					</ThemedText>
					{recent.length === 0 ? (
						<ThemedText className='text-sm text-muted'>
							{ctx?.sawOsc
								? 'No commands yet.'
								: 'Waiting for shell integration. Toggle it in Settings → Shell integration, or per host on the server screen.'}
						</ThemedText>
					) : (
						<ScrollView style={{ maxHeight: 280 }}>
							<View className='gap-1.5'>
								{recent.map((cmd, i) => (
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
				className='flex-1 text-sm text-text-primary'
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

/** ✓ (green) for exit 0, ✗N (red) for non-zero, nothing when the shell omitted it. */
function ExitBadge({ code }: { code: number | undefined }) {
	if (code === undefined) {
		return null;
	}
	return code === 0 ? (
		<ThemedText className='text-xs font-bold text-success'>✓</ThemedText>
	) : (
		<ThemedText className='text-xs font-bold text-danger'>✗{code}</ThemedText>
	);
}

/** Last path segment of an absolute cwd (`/home/ethan/proj` → `proj`). */
function basename(cwd: string) {
	// TODO: Should we or could we use the effect-ts Path module to do this? (maybe not, it might require bun or node)
	const parts = cwd.split('/').filter(Boolean);
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
