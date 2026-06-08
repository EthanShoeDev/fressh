import React from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/themed/Button';
import { ThemedText } from '@/components/themed/ThemedText';
import { useThemeSkin } from '@/lib/theme-skin';

/**
 * A small modal that captures a new local label. Shared by the saved-host rename
 * (servers list) and the shell-session rename (server detail) so the markup lives
 * in one place. `onSave` receives the trimmed value (empty string ⇒ caller should
 * treat as "clear the label").
 */
export function RenameDialog({
	title,
	description,
	initial,
	placeholder,
	onClose,
	onSave,
}: {
	title: string;
	description: string;
	initial: string;
	placeholder: string;
	onClose: () => void;
	onSave: (next: string) => void | Promise<void>;
}) {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border-strong') as string;
	const primary = useCSSVariable('--color-primary') as string;
	const [value, setValue] = React.useState(initial);
	const [saving, setSaving] = React.useState(false);

	const save = () => {
		if (saving) {
			return;
		}
		setSaving(true);
		void Promise.resolve(onSave(value.trim())).catch(() => setSaving(false));
	};

	return (
		<Modal transparent visible animationType='fade' onRequestClose={onClose}>
			<View className='flex-1 items-center justify-center p-6'>
				<Pressable className='absolute inset-0 bg-overlay' onPress={onClose} />
				<View
					style={{
						backgroundColor: surface,
						borderColor: border,
						borderWidth: 1,
						borderRadius: skin.radius,
					}}
					className='w-full gap-4 p-5'
				>
					<View>
						<ThemedText className='text-lg font-bold text-text-primary'>
							{title}
						</ThemedText>
						<ThemedText className='mt-1.5 text-[13px] leading-5 text-muted'>
							{description}
						</ThemedText>
					</View>
					<TextInput
						autoFocus
						value={value}
						onChangeText={setValue}
						placeholder={placeholder}
						placeholderTextColorClassName='accent-muted'
						className='px-3.5 py-3 text-base text-text-primary'
						style={{
							borderWidth: 1.5,
							borderColor: primary,
							borderRadius: skin.controlRadius,
							backgroundColor: 'rgba(0,0,0,0.25)',
						}}
						onSubmitEditing={save}
					/>
					<View className='flex-row gap-2.5'>
						<Button
							className='flex-1'
							variant='outline'
							title='Cancel'
							onPress={onClose}
						/>
						<Button
							className='flex-1'
							title='Save'
							loading={saving}
							loadingTitle='Saving…'
							onPress={save}
						/>
					</View>
				</View>
			</View>
		</Modal>
	);
}
