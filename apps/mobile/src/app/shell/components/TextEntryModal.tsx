import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Animated,
	Dimensions,
	InteractionManager,
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	PanResponder,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from 'react-native';
import { closeThenDismissKeyboard } from '@/lib/deferred-keyboard-dismiss';
import { useTheme } from '@/lib/theme';

const MIN_LINES = 6;
const LINE_HEIGHT = 20;
const INPUT_VERTICAL_PADDING = 12;

export type TextInputScreenBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export function TextEntryModal({
	open,
	bottomOffset,
	onClose,
	onPaste,
	wisprMode = false,
	wisprStatusText,
	onWisprSetup,
	onWisprFocus,
	onValueChange,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onPaste: (value: string) => void;
	wisprMode?: boolean;
	wisprStatusText?: string;
	onWisprSetup?: () => void;
	onWisprFocus?: (value: string, bounds?: TextInputScreenBounds) => void;
	onValueChange?: (value: string) => void;
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
	const dialogMaxHeight = useMemo(() => {
		// Android doesn't use KeyboardAvoidingView padding, so we size against the
		// "usable" height above the keyboard/footer offset to keep controls visible.
		const windowHeight = Dimensions.get('window').height;
		const usableHeight = Math.max(240, windowHeight - bottomOffset);
		return Math.floor(usableHeight * 0.92);
	}, [bottomOffset]);
	const [value, setValue] = useState('');
	const [textAreaContentHeight, setTextAreaContentHeight] = useState(minHeight);
	const valueRef = useRef('');
	const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [qaMode, setQaMode] = useState(false);
	const [questionNumber, setQuestionNumber] = useState(1);
	const questionNumberRef = useRef(1);
	const qaNudgePaddingX = 24;
	const qaChoicePaddingX = 28;
	const hasWisprStatusText = Boolean(wisprStatusText);

	// Keep the dialog within `maxHeight: '85%'` without allowing extra controls to
	// overflow the frame by shrinking the text area when needed.
	const effectiveTextMaxHeight = useMemo(() => {
		// Rough chrome height budget:
		// - dialog padding: 32
		// - header row + spacing: ~52
		// - QA row + spacing (when enabled): ~56
		// - Wispr status line + spacing (when present): ~24
		// - bottom buttons row + spacing: ~60
		const chrome =
			32 + 52 + (qaMode ? 56 : 0) + (hasWisprStatusText ? 24 : 0) + 60;
		const maxByDialog = Math.max(minHeight, dialogMaxHeight - chrome);
		return Math.max(minHeight, Math.min(maxHeight, maxByDialog));
	}, [dialogMaxHeight, hasWisprStatusText, maxHeight, minHeight, qaMode]);

	const textAreaHeight = useMemo(() => {
		const nextHeight = Math.min(
			Math.max(textAreaContentHeight, minHeight),
			effectiveTextMaxHeight,
		);
		return nextHeight;
	}, [effectiveTextMaxHeight, minHeight, textAreaContentHeight]);

	const setQuestionNumberSafe = useCallback((next: number) => {
		const normalized = Math.max(1, Math.floor(next));
		questionNumberRef.current = normalized;
		setQuestionNumber(normalized);
	}, []);

	const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
	const dragStartRef = useRef({ x: 0, y: 0 });
	const resetDrag = useCallback(() => {
		drag.stopAnimation(() => {
			dragStartRef.current = { x: 0, y: 0 };
			drag.setValue({ x: 0, y: 0 });
		});
	}, [drag]);
	const panResponder = useMemo(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => true,
				onMoveShouldSetPanResponder: (_, gesture) =>
					Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
				onMoveShouldSetPanResponderCapture: (_, gesture) =>
					Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
				onPanResponderGrant: () => {
					drag.stopAnimation((val) => {
						dragStartRef.current = { x: val.x, y: val.y };
					});
				},
				onPanResponderMove: (_, gesture) => {
					drag.setValue({
						x: dragStartRef.current.x + gesture.dx,
						y: dragStartRef.current.y + gesture.dy,
					});
				},
				onPanResponderRelease: () => {
					// Clamp to a sane range so the dialog can't be dragged completely off-screen.
					const { width, height } = Dimensions.get('window');
					const maxX = Math.floor(width * 0.35);
					const minX = -maxX;
					const maxY = Math.floor(height * 0.35);
					const minY = -maxY;
					drag.stopAnimation((val) => {
						drag.setValue({
							x: Math.min(maxX, Math.max(minX, val.x)),
							y: Math.min(maxY, Math.max(minY, val.y)),
						});
					});
				},
				onPanResponderTerminationRequest: () => false,
			}),
		[drag],
	);

	useEffect(() => {
		if (!open) resetDrag();
	}, [open, resetDrag]);

	const focusInput = useCallback((delayMs = 0) => {
		if (focusTimeoutRef.current) {
			clearTimeout(focusTimeoutRef.current);
			focusTimeoutRef.current = null;
		}
		if (delayMs > 0) {
			focusTimeoutRef.current = setTimeout(() => {
				inputRef.current?.blur();
				inputRef.current?.focus();
			}, delayMs);
			return;
		}
		inputRef.current?.blur();
		inputRef.current?.focus();
	}, []);

	const handleModalShow = useCallback(() => {
		// Modal is now fully visible - safe to focus
		if (Platform.OS === 'android') {
			InteractionManager.runAfterInteractions(() => {
				requestAnimationFrame(() => {
					focusInput();
					focusInput(120);
				});
			});
			return;
		}
		focusInput();
	}, [focusInput]);

	useEffect(
		() => () => {
			if (focusTimeoutRef.current) {
				clearTimeout(focusTimeoutRef.current);
				focusTimeoutRef.current = null;
			}
		},
		[],
	);

	const handleClose = useCallback(() => {
		if (focusTimeoutRef.current) {
			clearTimeout(focusTimeoutRef.current);
			focusTimeoutRef.current = null;
		}
		// Preserve text when closing - user can reopen and continue editing
		closeThenDismissKeyboard({
			close: onClose,
			dismissKeyboard: () => Keyboard.dismiss(),
		});
	}, [onClose]);

	const updateValue = useCallback(
		(nextValue: string) => {
			valueRef.current = nextValue;
			setValue(nextValue);
			onValueChange?.(nextValue);
		},
		[onValueChange],
	);

	const handleClear = useCallback(() => {
		updateValue('');
		setTextAreaContentHeight(minHeight);
		setQuestionNumberSafe(1);
		inputRef.current?.focus();
	}, [minHeight, setQuestionNumberSafe, updateValue]);

	const handlePaste = useCallback(() => {
		if (!value) return;
		const pasteValue = value;
		closeThenDismissKeyboard({
			close: onClose,
			dismissKeyboard: () => Keyboard.dismiss(),
		});
		onPaste(pasteValue);
		// Clear local text after handing the paste off to the shell.
		updateValue('');
		setTextAreaContentHeight(minHeight);
		setQuestionNumberSafe(1);
	}, [minHeight, onClose, onPaste, setQuestionNumberSafe, updateValue, value]);

	const handleToggleQaMode = useCallback(() => {
		const next = !qaMode;
		setQaMode(next);
		if (next) setQuestionNumberSafe(1);
		requestAnimationFrame(() => focusInput());
	}, [focusInput, qaMode, setQuestionNumberSafe]);

	const insertAnswer = useCallback(
		(answer: 'A' | 'B' | 'C') => {
			const n = questionNumberRef.current;
			const snippet = `${n}${answer} `;
			const currentValue = valueRef.current;
			const separator = currentValue && !/\s$/.test(currentValue) ? ' ' : '';
			updateValue(`${currentValue}${separator}${snippet}`);
			setQuestionNumberSafe(n + 1);
			requestAnimationFrame(() => focusInput());
		},
		[focusInput, setQuestionNumberSafe, updateValue],
	);

	const handleChangeText = useCallback(
		(nextValue: string) => {
			updateValue(nextValue);
		},
		[updateValue],
	);

	const handleInputFocus = useCallback(() => {
		if (!wisprMode) return;
		inputRef.current?.measureInWindow((x, y, width, height) => {
			onWisprFocus?.(valueRef.current, { x, y, width, height });
		});
	}, [onWisprFocus, wisprMode]);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
			onShow={handleModalShow}
		>
			<View style={{ flex: 1, backgroundColor: theme.colors.overlay }}>
				{/* Tap outside the dialog to close. Kept behind the dialog so it doesn't steal drags/taps. */}
				<Pressable
					onPress={handleClose}
					style={{
						position: 'absolute',
						left: 0,
						right: 0,
						top: 0,
						bottom: 0,
					}}
				/>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{
						flex: 1,
						justifyContent: 'center',
						paddingBottom: bottomOffset,
					}}
					pointerEvents="box-none"
				>
					<Animated.View style={{ transform: drag.getTranslateTransform() }}>
						<View
							style={{
								backgroundColor: theme.colors.background,
								borderRadius: 16,
								padding: 16,
								borderColor: theme.colors.borderStrong,
								borderWidth: 1,
								maxHeight: dialogMaxHeight,
								overflow: 'hidden',
								width: '90%',
								maxWidth: 520,
								minWidth: 280,
								alignSelf: 'center',
							}}
						>
							<View
								{...panResponder.panHandlers}
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
									Text
								</Text>
								<Pressable
									onPress={handleToggleQaMode}
									style={{
										borderRadius: 10,
										paddingVertical: 8,
										paddingHorizontal: 12,
										borderWidth: 1,
										borderColor: qaMode
											? theme.colors.primary
											: theme.colors.border,
										backgroundColor: qaMode
											? theme.colors.primary
											: 'transparent',
									}}
								>
									<Text
										style={{
											color: qaMode
												? theme.colors.buttonTextOnPrimary
												: theme.colors.textSecondary,
											fontWeight: '800',
										}}
									>
										QA
									</Text>
								</Pressable>
							</View>
							<TextInput
								ref={inputRef}
								value={value}
								onChangeText={handleChangeText}
								onFocus={handleInputFocus}
								placeholder="Enter text to paste..."
								placeholderTextColor={theme.colors.muted}
								autoFocus
								showSoftInputOnFocus
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
									maxHeight: effectiveTextMaxHeight,
									lineHeight: LINE_HEIGHT,
									width: '100%',
								}}
								onContentSizeChange={(event) => {
									setTextAreaContentHeight(
										event.nativeEvent.contentSize.height +
											INPUT_VERTICAL_PADDING,
									);
								}}
								scrollEnabled={textAreaHeight >= effectiveTextMaxHeight}
							/>
							{wisprStatusText ? (
								<View
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										gap: 8,
										marginTop: 8,
									}}
								>
									<Text
										numberOfLines={1}
										ellipsizeMode="tail"
										style={{
											color: theme.colors.textSecondary,
											flex: 1,
											fontSize: 12,
											fontWeight: '500',
											lineHeight: 16,
										}}
									>
										{wisprStatusText}
									</Text>
									{onWisprSetup ? (
										<Pressable
											onPress={onWisprSetup}
											style={{
												borderRadius: 8,
												paddingVertical: 6,
												paddingHorizontal: 10,
												borderWidth: 1,
												borderColor: theme.colors.border,
											}}
										>
											<Text
												style={{
													color: theme.colors.textSecondary,
													fontSize: 12,
													fontWeight: '700',
												}}
											>
												Enable
											</Text>
										</Pressable>
									) : null}
								</View>
							) : null}
							{qaMode ? (
								<View
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										justifyContent: 'space-between',
										marginTop: 12,
										gap: 8,
									}}
								>
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											gap: 6,
										}}
									>
										<Pressable
											onPress={() => {
												setQuestionNumberSafe(questionNumberRef.current - 1);
												requestAnimationFrame(() => focusInput());
											}}
											style={{
												borderRadius: 10,
												paddingVertical: 10,
												paddingHorizontal: qaNudgePaddingX,
												borderWidth: 1,
												borderColor: theme.colors.border,
											}}
										>
											<Text
												style={{
													color: theme.colors.textSecondary,
													fontWeight: '700',
												}}
											>
												-
											</Text>
										</Pressable>
										<Text
											style={{
												color: theme.colors.textPrimary,
												fontWeight: '700',
												minWidth: 42,
												textAlign: 'center',
											}}
										>
											Q{questionNumber}
										</Text>
										<Pressable
											onPress={() => {
												setQuestionNumberSafe(questionNumberRef.current + 1);
												requestAnimationFrame(() => focusInput());
											}}
											style={{
												borderRadius: 10,
												paddingVertical: 10,
												paddingHorizontal: qaNudgePaddingX,
												borderWidth: 1,
												borderColor: theme.colors.border,
											}}
										>
											<Text
												style={{
													color: theme.colors.textSecondary,
													fontWeight: '700',
												}}
											>
												+
											</Text>
										</Pressable>
									</View>
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											gap: 6,
										}}
									>
										{(['A', 'B', 'C'] as const).map((answer) => (
											<Pressable
												key={answer}
												onPress={() => insertAnswer(answer)}
												style={{
													borderRadius: 10,
													paddingVertical: 10,
													paddingHorizontal: qaChoicePaddingX,
													backgroundColor: theme.colors.surface,
													borderWidth: 1,
													borderColor: theme.colors.border,
												}}
											>
												<Text
													style={{
														color: theme.colors.textPrimary,
														fontWeight: '800',
													}}
												>
													{answer}
												</Text>
											</Pressable>
										))}
									</View>
								</View>
							) : null}
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
					</Animated.View>
				</KeyboardAvoidingView>
			</View>
		</Modal>
	);
}
