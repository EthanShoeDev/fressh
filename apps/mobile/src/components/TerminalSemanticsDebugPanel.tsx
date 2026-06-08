import { Ionicons } from '@expo/vector-icons';
import { sendData } from '@fressh/react-native-terminal';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { rootLogger } from '@/lib/logger';
import {
	useShellEventLog,
	useShellSemantics,
} from '@/lib/terminal-semantics';

const logger = rootLogger.extend('SemanticsDebug');

/**
 * A deliberately-visible debug panel for the terminal semantic-events seam
 * (OSC 7 cwd + OSC 133 command lifecycle). Unlike the eventual product UI, this
 * renders ALWAYS — so you can confirm the JS side is wired even before any event
 * arrives — and includes a "Emit test OSC" button that asks the remote shell to
 * `printf` a cwd + command-start/finish sequence. Those bytes travel back through
 * the real native scanner, so a tap exercises the WHOLE pipeline (Rust scanner →
 * CoreEvent → uniffi → addFresshEventListener → store → this UI).
 *
 * Remove once the seam is trusted; the product surface is the compact badge.
 */
export function TerminalSemanticsDebugPanel({ shellId }: { shellId: string }) {
	const sem = useShellSemantics(shellId);
	const log = useShellEventLog(shellId);
	const [collapsed, setCollapsed] = useState(false);

	const [surface, border, secondary, primary, danger, onPrimary] =
		useCSSVariable([
			'--color-surface',
			'--color-border',
			'--color-text-secondary',
			'--color-primary',
			'--color-danger',
			'--color-button-text-on-primary',
		]) as [string, string, string, string, string, string];

	const emitTest = useCallback(() => {
		// Ask the remote shell to print its REAL cwd (OSC 7, via $PWD) then a
		// command start/finish (OSC 133 C/D) with a ~300ms gap so duration is
		// non-zero. `\033`/`\007` are octal escapes bash's printf expands to
		// ESC / BEL; `%s` consumes "$PWD" so the reported path is the actual one.
		const cmd =
			'printf \'\\033]7;file://h%s\\007\' "$PWD"; printf \'\\033]133;C\\007\'; sleep 0.3; printf \'\\033]133;D;0\\007\'\r';
		const bytes = new Uint8Array(cmd.length);
		for (let i = 0; i < cmd.length; i++) bytes[i] = cmd.codePointAt(i) ?? 0;
		void sendData(shellId, bytes.buffer).catch((error: unknown) =>
			logger.warn('emit test OSC failed', error),
		);
	}, [shellId]);

	if (collapsed) {
		return (
			<Pressable
				onPress={() => setCollapsed(false)}
				className='absolute right-2 top-2 flex-row items-center gap-1 rounded-lg px-2.5 py-1'
				style={{ backgroundColor: surface, borderWidth: 1, borderColor: border }}
			>
				<Ionicons name='pulse-outline' size={14} color={primary} />
				<Text className='text-text-secondary text-xs'>OSC {log.length}</Text>
			</Pressable>
		);
	}

	const exitColor =
		sem?.lastExitCode === undefined
			? secondary
			: sem.lastExitCode === 0
				? primary
				: danger;

	return (
		<View
			className='absolute left-2 right-2 top-2 gap-1.5 rounded-lg p-2'
			style={{
				backgroundColor: surface,
				borderWidth: 1,
				borderColor: border,
				maxHeight: 240,
			}}
		>
			{/* Header */}
			<View className='flex-row items-center justify-between'>
				<View className='flex-row items-center gap-1.5'>
					<Ionicons name='pulse-outline' size={14} color={primary} />
					<Text className='text-text-primary text-xs font-semibold'>
						Terminal Semantics (debug)
					</Text>
				</View>
				<Pressable onPress={() => setCollapsed(true)} hitSlop={8}>
					<Ionicons name='chevron-up' size={16} color={secondary} />
				</Pressable>
			</View>

			{/* Derived state */}
			<View className='flex-row flex-wrap items-center gap-x-3 gap-y-1'>
				<Text className='text-text-secondary text-xs'>
					cwd: <Text className='text-text-primary'>{sem?.cwd ?? '—'}</Text>
				</Text>
				<Text className='text-text-secondary text-xs'>
					{sem?.running ? 'running…' : 'idle'}
				</Text>
				<Text className='text-xs' style={{ color: exitColor }}>
					exit: {sem?.lastExitCode ?? '—'}
					{sem?.lastDurationMs !== undefined ? ` (${sem.lastDurationMs}ms)` : ''}
				</Text>
				<Text className='text-text-secondary text-xs'>
					cmds: {sem?.commandCount ?? 0}
				</Text>
			</View>

			{/* Raw event log */}
			<ScrollView
				style={{ maxHeight: 110 }}
				contentContainerClassName='gap-0.5'
				showsVerticalScrollIndicator
			>
				{log.length === 0 ? (
					<Text className='text-text-secondary text-xs italic'>
						No OSC events yet. Tap “Emit test OSC”, or enable shell integration
						(starship / iTerm2 / VS Code script) on the remote.
					</Text>
				) : (
					log.map((e) => (
						<Text
							key={e.id}
							numberOfLines={1}
							className='text-text-secondary text-xs'
							style={{ fontVariant: ['tabular-nums'] }}
						>
							<Text style={{ color: primary }}>{e.tag}</Text> {e.summary}
						</Text>
					))
				)}
			</ScrollView>

			{/* Test trigger */}
			<Pressable
				onPress={emitTest}
				className='flex-row items-center justify-center gap-1.5 rounded-md py-1.5'
				style={{ backgroundColor: primary }}
			>
				<Ionicons name='flash-outline' size={14} color={onPrimary} />
				<Text className='text-xs font-semibold' style={{ color: onPrimary }}>
					Emit test OSC
				</Text>
			</Pressable>
		</View>
	);
}
