import React from 'react';
import { Modal, Pressable, Switch, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ThemedText } from '@/components/themed/ThemedText';
import {
	addPreset,
	deletePreset,
	type Preset,
	updatePreset,
} from '@/lib/presets';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * Add / edit / delete a preset command. Shared by the in-shell toolbar page and
 * the Commands tab manager. `preset` undefined ⇒ "new" mode (Cancel + Save);
 * present ⇒ "edit" mode (Delete + Save).
 * See docs/projects/future/preset-command-buttons.md.
 */
export function PresetEditDialog({
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
		const next = { label: label.trim(), command: command.trim(), autoRun };
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
						{preset ? 'Edit command' : 'New command'}
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
