import { FontAwesome6 } from '@expo/vector-icons';
import React from 'react';
import {
	Modal,
	Pressable,
	ScrollView,
	Switch,
	TextInput,
	View,
} from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ThemedText } from '@/components/themed/ThemedText';
import {
	addPreset,
	deletePreset,
	type Preset,
	updatePreset,
	usePresets,
} from '@/lib/presets';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * Page 2 of the paged keyboard toolbar: one-tap preset commands. Tap runs the
 * preset (via `onRun`, which sends it to the PTY); long-press edits it; the
 * trailing `+` adds a new one. See docs/projects/future/preset-command-buttons.md.
 */
export function PresetsToolbarPage({
	onRun,
}: {
	onRun: (preset: Preset) => void;
}) {
	const presets = usePresets();
	const skin = useThemeSkin();
	const border = useCSSVariable('--color-border') as string;
	const surface = useCSSVariable('--color-surface') as string;
	const primary = useCSSVariable('--color-primary') as string;

	// null = closed; 'new' = add; otherwise the preset being edited.
	const [editing, setEditing] = React.useState<Preset | 'new' | null>(null);

	return (
		<View className='flex-1 justify-center'>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				keyboardShouldPersistTaps='handled'
				contentContainerStyle={{
					alignItems: 'center',
					gap: 7,
					paddingRight: 4,
				}}
			>
				{presets.length === 0 ? (
					<ThemedText className='px-1 text-xs text-muted'>
						No presets yet — tap
					</ThemedText>
				) : null}

				{presets.map((preset) => (
					<Pressable
						key={preset.id}
						onPress={() => onRun(preset)}
						onLongPress={() => setEditing(preset)}
						className='items-center justify-center px-3 py-2'
						style={{
							borderRadius: skin.controlRadius,
							borderWidth: 1,
							borderColor: border,
							backgroundColor: surface,
						}}
					>
						<ThemedText
							className='text-[13px] font-semibold text-text-primary'
							numberOfLines={1}
							style={skin.mono ? { fontFamily: skin.monoFamily } : undefined}
						>
							{preset.label}
						</ThemedText>
					</Pressable>
				))}

				<Pressable
					accessibilityLabel='Add preset command'
					onPress={() => setEditing('new')}
					className='h-9 w-9 items-center justify-center'
					style={{
						borderRadius: skin.controlRadius,
						borderWidth: 1,
						borderColor: border,
						backgroundColor: surface,
					}}
				>
					<FontAwesome6 name='plus' size={13} color={primary} />
				</Pressable>
			</ScrollView>

			{editing ? (
				<PresetEditDialog
					preset={editing === 'new' ? undefined : editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</View>
	);
}

function PresetEditDialog({
	preset,
	onClose,
}: {
	preset: Preset | undefined;
	onClose: () => void;
}) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const borderStrong = useCSSVariable('--color-border-strong') as string;
	const primary = useCSSVariable('--color-primary') as string;
	const [label, setLabel] = React.useState(preset?.label ?? '');
	const [command, setCommand] = React.useState(preset?.command ?? '');
	const [autoRun, setAutoRun] = React.useState(preset?.autoRun ?? true);

	const canSave = label.trim().length > 0 && command.trim().length > 0;

	const onSave = () => {
		if (!canSave) {
			return;
		}
		const next = {
			label: label.trim(),
			command: command.trim(),
			autoRun,
		};
		if (preset) {
			updatePreset(preset.id, next);
		} else {
			addPreset(next);
		}
		onClose();
	};

	const inputStyle = {
		borderWidth: 1.5,
		borderColor: primary,
		borderRadius: skin.controlRadius,
		backgroundColor: 'rgba(0,0,0,0.25)',
	} as const;

	return (
		<Modal transparent visible animationType='fade' onRequestClose={onClose}>
			<View className='flex-1 items-center justify-center p-6'>
				<Pressable className='absolute inset-0 bg-overlay' onPress={onClose} />
				<View
					style={{
						backgroundColor: surface,
						borderColor: borderStrong,
						borderWidth: 1,
						borderRadius: skin.radius,
					}}
					className='w-full gap-4 p-5'
				>
					<ThemedText className='text-lg font-bold text-text-primary'>
						{preset ? 'Edit preset' : 'New preset'}
					</ThemedText>

					<View className='gap-1.5'>
						<ThemedText className='text-xs font-semibold uppercase text-muted'>
							Label
						</ThemedText>
						<TextInput
							autoFocus={!preset}
							value={label}
							onChangeText={setLabel}
							placeholder='git status'
							placeholderTextColorClassName='accent-muted'
							className='px-3.5 py-3 text-base text-text-primary'
							style={inputStyle}
						/>
					</View>

					<View className='gap-1.5'>
						<ThemedText className='text-xs font-semibold uppercase text-muted'>
							Command
						</ThemedText>
						<TextInput
							value={command}
							onChangeText={setCommand}
							placeholder='git status -sb'
							placeholderTextColorClassName='accent-muted'
							autoCapitalize='none'
							autoCorrect={false}
							className='px-3.5 py-3 text-base text-text-primary'
							style={[
								inputStyle,
								skin.mono ? { fontFamily: skin.monoFamily } : null,
							]}
						/>
					</View>

					<Pressable
						onPress={() => setAutoRun((v) => !v)}
						className='flex-row items-center justify-between'
					>
						<View className='flex-1 pr-3'>
							<ThemedText className='text-sm font-semibold text-text-primary'>
								Run immediately
							</ThemedText>
							<ThemedText className='mt-0.5 text-xs text-muted'>
								Off ⇒ just type it into the prompt without pressing Enter
							</ThemedText>
						</View>
						<Switch
							value={autoRun}
							onValueChange={setAutoRun}
							accessibilityLabel='Run immediately'
						/>
					</Pressable>

					<View className='flex-row gap-2.5'>
						{preset ? (
							<Button
								className='flex-1'
								variant='danger'
								title='Delete'
								onPress={() => {
									deletePreset(preset.id);
									onClose();
								}}
							/>
						) : (
							<Button
								className='flex-1'
								variant='outline'
								title='Cancel'
								onPress={onClose}
							/>
						)}
						<Button
							className='flex-1'
							title='Save'
							disabled={!canSave}
							onPress={onSave}
						/>
					</View>
				</View>
			</View>
		</Modal>
	);
}
