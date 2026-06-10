import { runCommand } from '@fressh/react-native-terminal';
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { ThemedText } from '@/components/themed/ThemedText';
import {
	classifyDiffLine,
	type DiffLineKind,
	gitDiffCommand,
} from '@/lib/git-diff';
import { rootLogger } from '@/lib/logger';
import { useSshStore } from '@/lib/ssh-store';
import { useShellContext } from '@/lib/terminal-semantics';
import { useThemeSkin } from '@/lib/theme-skin';

const logger = rootLogger.extend('GitDiff');

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

	const connectionId = useSshStore((s) => s.shells[shellId]?.connectionId);
	const cwd = useShellContext(shellId)?.cwd;
	const skin = useThemeSkin();
	const monoFamily = skin.mono ? skin.monoFamily : undefined;
	const mono = monoFamily ? { fontFamily: monoFamily } : undefined;

	const [state, setState] = React.useState<State>({ kind: 'loading' });

	React.useEffect(() => {
		if (!connectionId || !cwd) {
			setState({ kind: 'error', message: 'Session no longer available.' });
			return;
		}
		let cancelled = false;
		setState({ kind: 'loading' });
		// Fire-and-forget: the IIFE handles its own errors (try/catch below) and
		// cancellation (the `cancelled` flag), so it never rejects — void it to
		// satisfy no-floating-promises.
		void (async () => {
			try {
				const res = await runCommand(
					connectionId,
					gitDiffCommand(cwd, file, { untracked }),
				);
				if (cancelled) return;
				// `--no-index` (untracked) exits 1 when a diff exists — that's success here,
				// so only treat a non-zero exit as an error for tracked files.
				if (!untracked && res.exitCode !== 0) {
					setState({
						kind: 'error',
						message: res.stderr.trim() || `git diff exited ${res.exitCode}`,
					});
					return;
				}
				const text = res.stdout.replace(/\n$/, '');
				if (!text) {
					setState({ kind: 'empty' });
					return;
				}
				const all = text.split('\n');
				setState({
					kind: 'ok',
					lines: all.slice(0, LINE_CAP),
					truncated: all.length > LINE_CAP,
				});
			} catch (error) {
				if (cancelled) return;
				logger.warn('git diff failed', file, error);
				setState({ kind: 'error', message: String(error) });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [connectionId, cwd, file, untracked]);

	return (
		<View className='flex-1 bg-background'>
			<Stack.Screen options={{ title: basename(file) }} />

			<View className='border-b border-border bg-surface px-3 py-1.5'>
				<ThemedText
					className='text-xs text-muted'
					numberOfLines={1}
					style={mono}
				>
					{file}
				</ThemedText>
			</View>

			{state.kind === 'loading' ? (
				<View className='flex-1 items-center justify-center'>
					<ActivityIndicator />
				</View>
			) : state.kind === 'error' ? (
				<View className='flex-1 items-center justify-center px-6'>
					<ThemedText className='text-center text-sm text-danger' style={mono}>
						{state.message}
					</ThemedText>
				</View>
			) : state.kind === 'empty' ? (
				<View className='flex-1 items-center justify-center'>
					<ThemedText className='text-sm text-muted'>
						No changes to show.
					</ThemedText>
				</View>
			) : (
				<ScrollView className='flex-1'>
					<ScrollView horizontal contentContainerStyle={{ paddingVertical: 8 }}>
						<View className='px-3'>
							{state.lines.map((line, i) => (
								<DiffLine key={i} line={line} mono={mono} />
							))}
							{state.truncated ? (
								<ThemedText className='py-2 text-xs text-muted' style={mono}>
									… diff truncated at {LINE_CAP} lines
								</ThemedText>
							) : null}
						</View>
					</ScrollView>
				</ScrollView>
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
	const parts = path.split('/').filter(Boolean);
	return parts.at(-1) ?? path;
}
