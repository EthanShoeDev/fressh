import { type CommandResult, runCommand } from '@fressh/react-native-terminal';
import React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/themed/Button';
import { ThemedText } from '@/components/themed/ThemedText';
import { rootLogger } from '@/lib/logger';
import { usePresets } from '@/lib/presets';
import { useThemeSkin } from '@/lib/theme-skin';

const logger = rootLogger.extend('RunCommand');

/**
 * Run a one-off command on a *live* connection (a sibling no-PTY `exec` channel —
 * the interactive shell is untouched). Runs in the login/home dir; `cd … && …` in
 * the command if you need a directory. See preset-command-buttons.md.
 */
export function RunCommandSheet({
	connectionId,
	title,
	onClose,
}: {
	connectionId: string;
	title: string;
	onClose: () => void;
}) {
	const skin = useThemeSkin();
	const primary = useCSSVariable('--color-primary') as string;
	const border = useCSSVariable('--color-border') as string;
	const surface = useCSSVariable('--color-surface') as string;
	const presets = usePresets();
	const mono =
		skin.mono && skin.monoFamily ? { fontFamily: skin.monoFamily } : undefined;

	const [command, setCommand] = React.useState('');
	const [running, setRunning] = React.useState(false);
	const [result, setResult] = React.useState<CommandResult | null>(null);
	const [error, setError] = React.useState<string | null>(null);

	const run = async () => {
		const cmd = command.trim();
		if (!cmd || running) {
			return;
		}
		setRunning(true);
		setResult(null);
		setError(null);
		try {
			setResult(await runCommand(connectionId, cmd));
		} catch (error) {
			logger.warn('run command failed', error);
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setRunning(false);
		}
	};

	return (
		<BottomSheet onClose={onClose} maxHeightPct={88}>
			<View className='gap-3 p-5'>
				<View>
					<ThemedText className='text-lg font-bold text-text-primary'>
						Run on {title}
					</ThemedText>
					<ThemedText className='mt-1 text-xs text-muted'>
						Runs in your home directory, no shell opened. Use “cd … &&” for a
						different folder.
					</ThemedText>
				</View>

				<TextInput
					autoFocus
					value={command}
					onChangeText={setCommand}
					placeholder='e.g. df -h'
					placeholderTextColorClassName='accent-muted'
					autoCapitalize='none'
					autoCorrect={false}
					onSubmitEditing={run}
					className='px-3.5 py-3 text-base text-text-primary'
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
						{presets.map((p) => (
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
								<ThemedText className='text-xs font-semibold text-text-primary'>
									{p.label}
								</ThemedText>
							</Pressable>
						))}
					</ScrollView>
				) : null}

				<Button
					title='Run'
					loading={running}
					loadingTitle='Running…'
					disabled={command.trim().length === 0}
					onPress={run}
				/>

				{error ? (
					<ThemedText className='text-sm text-danger' style={mono}>
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
					<ThemedText className='text-xs font-bold text-success'>
						✓ exit 0
					</ThemedText>
				) : (
					<ThemedText className='text-xs font-bold text-danger'>
						✗ exit {code}
					</ThemedText>
				)}
			</View>
			<ScrollView
				style={{ maxHeight: 320 }}
				className='rounded-lg border border-border bg-background p-3'
			>
				{result.stdout ? (
					<ThemedText className='text-[13px] text-text-primary' style={mono}>
						{result.stdout}
					</ThemedText>
				) : null}
				{result.stderr ? (
					<ThemedText className='mt-1 text-[13px] text-danger' style={mono}>
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
