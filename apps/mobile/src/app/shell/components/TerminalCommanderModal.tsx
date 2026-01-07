import React, { useCallback, useState } from 'react';
import {
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

const COMMANDER_SHORTCUTS = [
	{
		name: 'Ctrl+C',
		sequence: '\x03',
		description: 'Interrupt/Cancel current process',
	},
	{
		name: 'Ctrl+D',
		sequence: '\x04',
		description: 'End of file (EOF) / Exit',
	},
	{
		name: 'Ctrl+Z',
		sequence: '\x1a',
		description: 'Suspend current process',
	},
	{
		name: 'Ctrl+A',
		sequence: '\x01',
		description: 'Move cursor to beginning of line',
	},
	{
		name: 'Ctrl+E',
		sequence: '\x05',
		description: 'Move cursor to end of line',
	},
	{
		name: 'Ctrl+K',
		sequence: '\x0b',
		description: 'Kill/Delete from cursor to end of line',
	},
	{
		name: 'Ctrl+U',
		sequence: '\x15',
		description: 'Kill/Delete from cursor to beginning of line',
	},
	{
		name: 'Ctrl+W',
		sequence: '\x17',
		description: 'Delete word before cursor',
	},
	{
		name: 'Ctrl+L',
		sequence: '\x0c',
		description: 'Clear screen',
	},
	{
		name: 'Ctrl+R',
		sequence: '\x12',
		description: 'Reverse search command history',
	},
	{
		name: 'Tab',
		sequence: '\t',
		description: 'Auto-complete',
	},
	{
		name: 'Escape',
		sequence: '\x1b',
		description: 'Escape key',
	},
];

export function TerminalCommanderModal({
	open,
	bottomOffset,
	onClose,
	onExecuteCommand,
	onPasteText,
	onSendShortcut,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onExecuteCommand: (value: string) => void;
	onPasteText: (value: string) => void;
	onSendShortcut: (sequence: string) => void;
}) {
	const theme = useTheme();
	const [commandInput, setCommandInput] = useState('');
	const [pasteInput, setPasteInput] = useState('');

	const handleClose = useCallback(() => {
		setCommandInput('');
		setPasteInput('');
		onClose();
	}, [onClose]);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{ flex: 1, justifyContent: 'flex-end' }}
				>
					<View
						onStartShouldSetResponder={() => true}
						style={{
							backgroundColor: theme.colors.background,
							borderTopLeftRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: '85%',
							width: '70%',
							maxWidth: 360,
							minWidth: 260,
							alignSelf: 'flex-end',
							marginRight: 8,
							marginBottom: bottomOffset,
						}}
					>
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
								marginBottom: 12,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 18,
									fontWeight: '700',
								}}
							>
								Terminal Commander
							</Text>
							<Pressable
								onPress={handleClose}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>
									Close
								</Text>
							</Pressable>
						</View>
						<ScrollView>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Execute Command
							</Text>
							<TextInput
								value={commandInput}
								onChangeText={setCommandInput}
								placeholder="ls -la"
								placeholderTextColor={theme.colors.muted}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									marginBottom: 10,
								}}
							/>
							<Pressable
								onPress={() => {
									if (!commandInput.trim()) return;
									onExecuteCommand(commandInput);
									handleClose();
								}}
								style={{
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									marginBottom: 16,
								}}
							>
								<Text
									style={{
										color: theme.colors.buttonTextOnPrimary,
										fontWeight: '700',
									}}
								>
									Execute
								</Text>
							</Pressable>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Paste Text
							</Text>
							<TextInput
								value={pasteInput}
								onChangeText={setPasteInput}
								placeholder="Enter text to paste..."
								placeholderTextColor={theme.colors.muted}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									minHeight: 90,
									textAlignVertical: 'top',
									marginBottom: 10,
								}}
								multiline
							/>
							<Pressable
								onPress={() => {
									if (!pasteInput.trim()) return;
									onPasteText(pasteInput);
									handleClose();
								}}
								style={{
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									marginBottom: 16,
								}}
							>
								<Text
									style={{
										color: theme.colors.buttonTextOnPrimary,
										fontWeight: '700',
									}}
								>
									Paste
								</Text>
							</Pressable>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Shortcuts
							</Text>
							{COMMANDER_SHORTCUTS.map((shortcut) => (
								<Pressable
									key={shortcut.name}
									onPress={() => {
										onSendShortcut(shortcut.sequence);
										handleClose();
									}}
									style={{
										paddingVertical: 12,
										paddingHorizontal: 12,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.surface,
										marginBottom: 8,
									}}
								>
									<Text
										style={{
											color: theme.colors.textPrimary,
											fontSize: 14,
											fontWeight: '600',
										}}
									>
										{shortcut.name}
									</Text>
									<Text
										style={{
											color: theme.colors.textSecondary,
											fontSize: 12,
											marginTop: 2,
										}}
									>
										{shortcut.description}
									</Text>
								</Pressable>
							))}
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
