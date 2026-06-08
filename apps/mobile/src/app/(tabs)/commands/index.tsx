import { FontAwesome6 } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { PresetEditDialog } from '@/components/terminal/PresetEditDialog';
import { RunCommandSheet } from '@/components/terminal/RunCommandSheet';
import { Button } from '@/components/themed/Button';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import {
	ThemedScreen,
	useSurfaceStyle,
} from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { type Preset, usePresets } from '@/lib/presets';
import { useSshStore } from '@/lib/ssh-store';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

/**
 * The "Commands" tab. v1 (this screen): manage preset commands — the list the
 * in-shell toolbar (page 2) also reads. Next: a one-off runner that execs a
 * command on a host without a persistent shell (needs the `fressh-ssh` exec
 * helper). See docs/projects/future/preset-command-buttons.md.
 */
export default function CommandsScreen() {
	const presets = usePresets();
	const skin = useThemeSkin();
	const marginBottom = useBottomTabSpacing();
	const primary = useCSSVariable('--color-primary') as string;
	const [editing, setEditing] = React.useState<Preset | 'new' | null>(null);
	const [runHost, setRunHost] = React.useState<{
		connectionId: string;
		label: string;
	} | null>(null);
	const liveConnections = useSshStore((s) => s.connections);

	return (
		<ThemedScreen edges={['top']}>
			<View className='flex-1'>
				<ScreenHeader
					title='Commands'
					right={
						<Pressable
							accessibilityRole='button'
							accessibilityLabel='New command'
							onPress={() => setEditing('new')}
							hitSlop={8}
							className='h-9 w-9 items-center justify-center border border-border bg-surface'
							style={{ borderRadius: skin.controlRadius }}
						>
							<FontAwesome6 name='plus' size={16} color={primary} />
						</Pressable>
					}
				/>
				<ScrollView
					className='flex-1'
					contentContainerStyle={{
						paddingHorizontal: 20,
						paddingTop: 12,
						paddingBottom: marginBottom,
					}}
				>
					<ThemedText className='mb-4 text-sm text-muted'>
						One-tap commands. They show on the terminal keyboard toolbar (swipe
						to the presets page) so you can run them in any shell.
					</ThemedText>

					{presets.length === 0 ? (
						<EmptyState onAdd={() => setEditing('new')} />
					) : (
						<View className='gap-2.5'>
							{presets.map((preset) => (
								<PresetRow
									key={preset.id}
									preset={preset}
									onPress={() => setEditing(preset)}
								/>
							))}
						</View>
					)}

					<ThemedText className='mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-muted'>
						{applyCase(skin, 'Run on a host · no shell')}
					</ThemedText>
					<RunSection
						connections={Object.values(liveConnections)}
						onPick={setRunHost}
					/>
				</ScrollView>

				{editing ? (
					<PresetEditDialog
						preset={editing === 'new' ? undefined : editing}
						onClose={() => setEditing(null)}
					/>
				) : null}
				{runHost ? (
					<RunCommandSheet
						connectionId={runHost.connectionId}
						title={runHost.label}
						onClose={() => setRunHost(null)}
					/>
				) : null}
			</View>
		</ThemedScreen>
	);
}

function RunSection({
	connections,
	onPick,
}: {
	connections: {
		connectionId: string;
		connectionDetails: { host: string; username: string };
	}[];
	onPick: (host: { connectionId: string; label: string }) => void;
}) {
	if (connections.length === 0) {
		return (
			<ThemedText className='text-sm text-muted'>
				Connect to a host (from the Servers tab) to run a one-off command here
				without opening another shell. Connecting fresh for a one-off is coming.
			</ThemedText>
		);
	}
	return (
		<View className='gap-2.5'>
			{connections.map((conn) => {
				const label = `${conn.connectionDetails.username}@${conn.connectionDetails.host}`;
				return (
					<HostRow
						key={conn.connectionId}
						label={label}
						onPress={() => onPick({ connectionId: conn.connectionId, label })}
					/>
				);
			})}
		</View>
	);
}

function HostRow({ label, onPress }: { label: string; onPress: () => void }) {
	const skin = useThemeSkin();
	const cardStyle = useSurfaceStyle();
	const muted = useCSSVariable('--color-muted') as string;
	const monoFamily = skin.mono ? skin.monoFamily : undefined;
	return (
		<Pressable
			onPress={onPress}
			className='flex-row items-center gap-3 px-4 py-3'
			style={cardStyle}
		>
			<FontAwesome6 name='server' size={13} color={muted} />
			<ThemedText
				className='flex-1 text-[15px] font-semibold text-text-primary'
				numberOfLines={1}
				style={monoFamily ? { fontFamily: monoFamily } : undefined}
			>
				{label}
			</ThemedText>
			<ThemedText className='text-[13px] font-bold text-primary'>
				{applyCase(skin, 'Run')} ›
			</ThemedText>
		</Pressable>
	);
}

function PresetRow({
	preset,
	onPress,
}: {
	preset: Preset;
	onPress: () => void;
}) {
	const skin = useThemeSkin();
	const cardStyle = useSurfaceStyle();
	const muted = useCSSVariable('--color-muted') as string;
	const monoFamily = skin.mono ? skin.monoFamily : undefined;
	return (
		<Pressable
			onPress={onPress}
			className='flex-row items-center gap-3 px-4 py-3'
			style={cardStyle}
		>
			<FontAwesome6 name='bolt' size={14} color={muted} />
			<View className='min-w-0 flex-1'>
				<ThemedText
					className='text-[15px] font-semibold text-text-primary'
					numberOfLines={1}
				>
					{preset.label}
				</ThemedText>
				<ThemedText
					className='mt-0.5 text-xs text-muted'
					numberOfLines={1}
					style={monoFamily ? { fontFamily: monoFamily } : undefined}
				>
					{preset.command}
					{preset.autoRun ? '' : '  (insert only)'}
				</ThemedText>
			</View>
			<FontAwesome6 name='pen' size={12} color={muted} />
		</Pressable>
	);
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<View className='mt-16 items-center gap-3 px-6'>
			<ThemedText className='text-base font-semibold text-text-primary'>
				No commands yet
			</ThemedText>
			<ThemedText className='text-center text-sm text-muted'>
				Add a command you run often — like git status or docker ps — and it’ll
				show on the terminal toolbar.
			</ThemedText>
			<Button className='mt-2' title='New command' onPress={onAdd} />
		</View>
	);
}
