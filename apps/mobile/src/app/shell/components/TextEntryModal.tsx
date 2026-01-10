import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Dimensions,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

const MIN_LINES = 6;
const LINE_HEIGHT = 20;
const INPUT_VERTICAL_PADDING = 12;

export function TextEntryModal({
	open,
	bottomOffset,
	onClose,
	onPaste,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onPaste: (value: string) => void;
}) {
	const theme = useTheme();
	const inputRef = useRef<TextInput | null>(null);
	const minHeight = useMemo(
		() => LINE_HEIGHT * MIN_LINES + INPUT_VERTICAL_PADDING * 2,
		[],
	);
	const maxHeight = useMemo(() => {
		const maxByScreen = Math.floor(Dimensions.get('window').height * 0.45);
		return Math.max(minHeight, Math.min(maxByScreen, 360));
	}, [minHeight]);
	const [value, setValue] = useState('');
	const [textAreaHeight, setTextAreaHeight] = useState(minHeight);

	useEffect(() => {
		if (!open) return;
		const timeout = setTimeout(() => {
			inputRef.current?.focus();
		}, 50);
		return () => clearTimeout(timeout);
	}, [open]);

	const handleClose = useCallback(() => {
		setValue('');
		setTextAreaHeight(minHeight);
		onClose();
	}, [minHeight, onClose]);

	const handleClear = useCallback(() => {
		setValue('');
		setTextAreaHeight(minHeight);
		inputRef.current?.focus();
	}, [minHeight]);

	const handlePaste = useCallback(() => {
		if (!value) return;
		onPaste(value);
		handleClose();
	}, [handleClose, onPaste, value]);

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
							borderTopRightRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: '85%',
							width: '100%',
							alignSelf: 'stretch',
							marginBottom: bottomOffset,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
								marginBottom: 12,
							}}
						>
							Text
						</Text>
						<TextInput
							ref={inputRef}
							value={value}
							onChangeText={setValue}
							placeholder="Enter text to paste..."
							placeholderTextColor={theme.colors.muted}
							autoFocus
							multiline
							textAlignVertical="top"
							style={{
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.inputBackground,
								color: theme.colors.textPrimary,
								borderRadius: 10,
								paddingHorizontal: 12,
								paddingVertical: INPUT_VERTICAL_PADDING,
								minHeight,
								height: textAreaHeight,
								maxHeight,
								lineHeight: LINE_HEIGHT,
								width: '100%',
							}}
							onContentSizeChange={(event) => {
								const nextHeight = Math.min(
									Math.max(
										event.nativeEvent.contentSize.height +
											INPUT_VERTICAL_PADDING,
										minHeight,
									),
									maxHeight,
								);
								setTextAreaHeight(nextHeight);
							}}
							scrollEnabled={textAreaHeight >= maxHeight}
						/>
						<View
							style={{
								flexDirection: 'row',
								marginTop: 12,
							}}
						>
							<Pressable
								onPress={handleClear}
								style={{
									flex: 1,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									borderWidth: 1,
									borderColor: theme.colors.border,
									marginRight: 8,
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
									Clear
								</Text>
							</Pressable>
							<Pressable
								onPress={handlePaste}
								style={{
									flex: 1,
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									marginRight: 8,
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
							<Pressable
								onPress={handleClose}
								style={{
									flex: 1,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
									Close
								</Text>
							</Pressable>
						</View>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
