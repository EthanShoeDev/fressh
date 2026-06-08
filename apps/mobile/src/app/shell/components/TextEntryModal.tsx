import {
	ChevronDown,
	ChevronUp,
	History,
	Pin,
	PinOff,
	Trash2,
} from 'lucide-react-native';
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
	ScrollView,
	Switch,
	Text,
	TextInput,
	View,
} from 'react-native';
import { closeThenDismissKeyboard } from '@/lib/deferred-keyboard-dismiss';
import { type TextEntryHistoryEntry } from '@/lib/text-entry-history';
import {
	getTextEntryHistoryCursorEntry,
	getTextEntryHistoryCursorLabel,
	type TextEntryHistoryCursorDirection,
} from '@/lib/text-entry-history-cursor';
import {
	getCurrentTextPinAction,
	shouldStartTextEntryModalPanResponder,
	shouldTextEntryModalClaimDragMove,
} from '@/lib/text-entry-history-interactions';
import { useTheme } from '@/lib/theme';
import { type TextEntryWisprControl } from '@/lib/wispr-automation';

const MIN_LINES = 6;
const LINE_HEIGHT = 20;
const INPUT_VERTICAL_PADDING = 12;

export type TextInputScreenBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type TextEntryHistoryModalProps = {
	cycleEntries: readonly TextEntryHistoryEntry[];
	pinnedEntries: readonly TextEntryHistoryEntry[];
	recentEntries: readonly TextEntryHistoryEntry[];
	onPinText: (text: string) => void;
	onPinEntry: (id: string) => void;
	onUnpinEntry: (id: string) => void;
	onDeleteEntry: (id: string) => void;
	onClearRecent: () => void;
};

const EMPTY_TEXT_ENTRY_HISTORY_ENTRIES: readonly TextEntryHistoryEntry[] = [];

export function TextEntryModal({
	open,
	bottomOffset,
	onClose,
	onPaste,
	wisprMode = false,
	wisprControl,
	onWisprSetup,
	onWisprAutoStartChange,
	onWisprFocus,
	onValueChange,
	history,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onPaste: (value: string) => void;
	wisprMode?: boolean;
	wisprControl?: TextEntryWisprControl;
	onWisprSetup?: () => void;
	onWisprAutoStartChange?: (enabled: boolean) => void;
	onWisprFocus?: (value: string, bounds?: TextInputScreenBounds) => void;
	onValueChange?: (value: string) => void;
	history?: TextEntryHistoryModalProps;
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
	const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
	const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState<
		string | null
	>(null);
	const valueRef = useRef('');
	const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const focusInteractionTaskRef = useRef<ReturnType<
		typeof InteractionManager.runAfterInteractions
	> | null>(null);
	const focusRafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(
		null,
	);
	const focusRequestIdRef = useRef(0);
	const modalOpenRef = useRef(open);
	modalOpenRef.current = open;
	const cycleEntries =
		history?.cycleEntries ?? EMPTY_TEXT_ENTRY_HISTORY_ENTRIES;
	const pinnedEntries =
		history?.pinnedEntries ?? EMPTY_TEXT_ENTRY_HISTORY_ENTRIES;
	const recentEntries =
		history?.recentEntries ?? EMPTY_TEXT_ENTRY_HISTORY_ENTRIES;
	const hasHistory = cycleEntries.length > 0;
	const currentHistoryEntry = useMemo(() => {
		if (!value) return undefined;
		return cycleEntries.find((entry) => entry.text === value);
	}, [cycleEntries, value]);
	const currentPinnedEntry = useMemo(() => {
		return currentHistoryEntry?.pinned ? currentHistoryEntry : undefined;
	}, [currentHistoryEntry]);
	const historyPositionLabel = useMemo(() => {
		return getTextEntryHistoryCursorLabel(cycleEntries, selectedHistoryEntryId);
	}, [cycleEntries, selectedHistoryEntryId]);

	const resetHistoryState = useCallback(() => {
		// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Called from the close effect to reset transient history controls.
		setHistoryPanelOpen(false);
		// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Called from the close effect to reset transient history controls.
		setSelectedHistoryEntryId(null);
	}, []);

	// Keep the dialog within `maxHeight: '85%'` without allowing extra controls to
	// overflow the frame by shrinking the text area when needed.
	const effectiveTextMaxHeight = useMemo(() => {
		// Rough chrome height budget:
		// - dialog padding: 32
		// - header row + spacing: ~52
		// - bottom buttons row + spacing: ~60
		const chrome = 32 + 52 + 60 + (historyPanelOpen ? 220 : 48);
		const maxByDialog = Math.max(minHeight, dialogMaxHeight - chrome);
		return Math.max(minHeight, Math.min(maxHeight, maxByDialog));
	}, [dialogMaxHeight, historyPanelOpen, maxHeight, minHeight]);

	const textAreaHeight = useMemo(() => {
		const nextHeight = Math.min(
			Math.max(textAreaContentHeight, minHeight),
			effectiveTextMaxHeight,
		);
		return nextHeight;
	}, [effectiveTextMaxHeight, minHeight, textAreaContentHeight]);

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
				onStartShouldSetPanResponder: shouldStartTextEntryModalPanResponder,
				onMoveShouldSetPanResponder: (_, gesture) =>
					shouldTextEntryModalClaimDragMove(gesture),
				onMoveShouldSetPanResponderCapture: (_, gesture) =>
					shouldTextEntryModalClaimDragMove(gesture),
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
		if (!open) {
			resetDrag();
			resetHistoryState();
		}
	}, [open, resetDrag, resetHistoryState]);

	const clearFocusTimeout = useCallback(() => {
		if (focusTimeoutRef.current) {
			clearTimeout(focusTimeoutRef.current);
			focusTimeoutRef.current = null;
		}
	}, []);

	const cancelScheduledFocusWork = useCallback(() => {
		if (focusInteractionTaskRef.current) {
			focusInteractionTaskRef.current.cancel();
			focusInteractionTaskRef.current = null;
		}
		if (focusRafRef.current != null) {
			cancelAnimationFrame(focusRafRef.current);
			focusRafRef.current = null;
		}
		clearFocusTimeout();
	}, [clearFocusTimeout]);

	const cancelPendingFocusWork = useCallback(() => {
		focusRequestIdRef.current += 1;
		cancelScheduledFocusWork();
	}, [cancelScheduledFocusWork]);

	const isFocusRequestActive = useCallback((requestId: number) => {
		return modalOpenRef.current && focusRequestIdRef.current === requestId;
	}, []);

	const focusInput = useCallback(
		(delayMs = 0, requestId = focusRequestIdRef.current) => {
			if (!isFocusRequestActive(requestId)) return;
			clearFocusTimeout();
			if (delayMs > 0) {
				focusTimeoutRef.current = setTimeout(() => {
					focusTimeoutRef.current = null;
					if (!isFocusRequestActive(requestId)) return;
					inputRef.current?.blur();
					inputRef.current?.focus();
				}, delayMs);
				return;
			}
			inputRef.current?.blur();
			inputRef.current?.focus();
		},
		[clearFocusTimeout, isFocusRequestActive],
	);

	const startFocusRequest = useCallback(() => {
		cancelScheduledFocusWork();
		focusRequestIdRef.current += 1;
		return focusRequestIdRef.current;
	}, [cancelScheduledFocusWork]);

	useEffect(() => {
		if (!open) {
			cancelPendingFocusWork();
		}
	}, [cancelPendingFocusWork, open]);

	const handleModalShow = useCallback(() => {
		const requestId = startFocusRequest();
		if (!isFocusRequestActive(requestId)) return;
		// Modal is now fully visible - safe to focus
		if (Platform.OS === 'android') {
			focusInteractionTaskRef.current = InteractionManager.runAfterInteractions(
				() => {
					focusInteractionTaskRef.current = null;
					if (!isFocusRequestActive(requestId)) return;
					focusRafRef.current = requestAnimationFrame(() => {
						focusRafRef.current = null;
						if (!isFocusRequestActive(requestId)) return;
						focusInput(0, requestId);
						focusInput(120, requestId);
					});
				},
			);
			return;
		}
		focusInput(0, requestId);
	}, [focusInput, isFocusRequestActive, startFocusRequest]);

	useEffect(
		() => () => {
			cancelPendingFocusWork();
		},
		[cancelPendingFocusWork],
	);

	const handleClose = useCallback(() => {
		cancelPendingFocusWork();
		resetHistoryState();
		// Preserve text when closing - user can reopen and continue editing
		closeThenDismissKeyboard({
			close: onClose,
			dismissKeyboard: () => Keyboard.dismiss(),
		});
	}, [cancelPendingFocusWork, onClose, resetHistoryState]);

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
		resetHistoryState();
		inputRef.current?.focus();
	}, [minHeight, resetHistoryState, updateValue]);

	const handlePaste = useCallback(() => {
		if (!value) return;
		const pasteValue = value;
		cancelPendingFocusWork();
		resetHistoryState();
		closeThenDismissKeyboard({
			close: onClose,
			dismissKeyboard: () => Keyboard.dismiss(),
		});
		onPaste(pasteValue);
		// Clear local text after handing the paste off to the shell.
		updateValue('');
		setTextAreaContentHeight(minHeight);
	}, [
		cancelPendingFocusWork,
		minHeight,
		onClose,
		onPaste,
		resetHistoryState,
		updateValue,
		value,
	]);

	const handleChangeText = useCallback(
		(nextValue: string) => {
			updateValue(nextValue);
			resetHistoryState();
		},
		[resetHistoryState, updateValue],
	);

	const handleInputFocus = useCallback(() => {
		if (!wisprMode) return;
		const requestId = focusRequestIdRef.current;
		inputRef.current?.measureInWindow((x, y, width, height) => {
			if (!isFocusRequestActive(requestId)) return;
			onWisprFocus?.(valueRef.current, { x, y, width, height });
		});
	}, [isFocusRequestActive, onWisprFocus, wisprMode]);

	const loadHistoryEntry = useCallback(
		(entry: TextEntryHistoryEntry) => {
			updateValue(entry.text);
			setSelectedHistoryEntryId(entry.id);
			setHistoryPanelOpen(false);
			inputRef.current?.focus();
		},
		[updateValue],
	);

	const handleCycleHistory = useCallback(
		(direction: TextEntryHistoryCursorDirection) => {
			const entry = getTextEntryHistoryCursorEntry(
				cycleEntries,
				selectedHistoryEntryId,
				direction,
			);
			if (entry) loadHistoryEntry(entry);
		},
		[cycleEntries, loadHistoryEntry, selectedHistoryEntryId],
	);

	const handleToggleCurrentPin = useCallback(() => {
		if (!history) return;
		const action = getCurrentTextPinAction({
			value,
			currentHistoryEntry,
		});
		if (action.type === 'pin-text') {
			history.onPinText(action.text);
			return;
		}
		if (action.type === 'pin-entry') {
			history.onPinEntry(action.id);
			return;
		}
		if (action.type === 'unpin-entry') {
			history.onUnpinEntry(action.id);
		}
	}, [currentHistoryEntry, history, value]);

	const handleToggleEntryPin = useCallback(
		(entry: TextEntryHistoryEntry) => {
			if (!history) return;
			if (entry.pinned) {
				history.onUnpinEntry(entry.id);
				return;
			}
			history.onPinEntry(entry.id);
		},
		[history],
	);

	const handleDeleteHistoryEntry = useCallback(
		(entry: TextEntryHistoryEntry) => {
			if (!history) return;
			history.onDeleteEntry(entry.id);
			if (selectedHistoryEntryId === entry.id) {
				setSelectedHistoryEntryId(null);
			}
		},
		[history, selectedHistoryEntryId],
	);

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
									gap: 12,
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
								<View
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										justifyContent: 'flex-end',
										flexShrink: 1,
										flexWrap: 'wrap',
										gap: 8,
									}}
								>
									{wisprControl?.type === 'switch' ? (
										<View
											style={{
												flexDirection: 'row',
												alignItems: 'center',
												gap: 8,
												borderRadius: 999,
												paddingVertical: 4,
												paddingLeft: 12,
												paddingRight: 6,
												borderWidth: 1,
												borderColor: wisprControl.enabled
													? theme.colors.primary
													: theme.colors.border,
												backgroundColor: wisprControl.enabled
													? theme.colors.surface
													: 'transparent',
											}}
										>
											<Text
												style={{
													color: theme.colors.textPrimary,
													fontSize: 12,
													fontWeight: '700',
												}}
											>
												{wisprControl.label}
											</Text>
											<Switch
												value={wisprControl.enabled}
												onValueChange={onWisprAutoStartChange}
												trackColor={{
													false: theme.colors.border,
													true: theme.colors.primary,
												}}
												thumbColor={theme.colors.textPrimary}
											/>
										</View>
									) : null}
									{wisprControl?.type === 'setup-pill' ? (
										<Pressable
											onPress={onWisprSetup}
											style={{
												borderRadius: 999,
												paddingVertical: 8,
												paddingHorizontal: 12,
												borderWidth: 1,
												borderColor: theme.colors.border,
												backgroundColor: theme.colors.surface,
											}}
										>
											<Text
												style={{
													color: theme.colors.textSecondary,
													fontSize: 12,
													fontWeight: '700',
												}}
											>
												{wisprControl.label}
											</Text>
										</Pressable>
									) : null}
									{history ? (
										<>
											<Pressable
												onPress={handleToggleCurrentPin}
												disabled={!value}
												style={{
													width: 36,
													height: 36,
													borderRadius: 999,
													alignItems: 'center',
													justifyContent: 'center',
													borderWidth: 1,
													borderColor: currentPinnedEntry
														? theme.colors.primary
														: theme.colors.border,
													backgroundColor: currentPinnedEntry
														? theme.colors.surface
														: 'transparent',
													opacity: value ? 1 : 0.45,
												}}
											>
												{currentPinnedEntry ? (
													<PinOff color={theme.colors.textPrimary} size={17} />
												) : (
													<Pin color={theme.colors.textSecondary} size={17} />
												)}
											</Pressable>
											<Pressable
												onPress={() => {
													setHistoryPanelOpen((current) => !current);
												}}
												disabled={!hasHistory}
												style={{
													width: 36,
													height: 36,
													borderRadius: 999,
													alignItems: 'center',
													justifyContent: 'center',
													borderWidth: 1,
													borderColor: historyPanelOpen
														? theme.colors.primary
														: theme.colors.border,
													backgroundColor: historyPanelOpen
														? theme.colors.surface
														: 'transparent',
													opacity: hasHistory ? 1 : 0.45,
												}}
											>
												<History
													color={
														historyPanelOpen
															? theme.colors.textPrimary
															: theme.colors.textSecondary
													}
													size={18}
												/>
											</Pressable>
										</>
									) : null}
								</View>
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
							{history ? (
								<View
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										marginTop: 10,
										gap: 8,
									}}
								>
									<Pressable
										onPress={() => {
											handleCycleHistory('previous');
										}}
										disabled={!hasHistory}
										style={{
											flex: 1,
											minHeight: 38,
											borderRadius: 10,
											borderWidth: 1,
											borderColor: theme.colors.border,
											alignItems: 'center',
											justifyContent: 'center',
											opacity: hasHistory ? 1 : 0.45,
										}}
									>
										<ChevronUp color={theme.colors.textSecondary} size={18} />
									</Pressable>
									<Text
										style={{
											color: theme.colors.textSecondary,
											fontSize: 12,
											minWidth: 54,
											textAlign: 'center',
										}}
									>
										{historyPositionLabel}
									</Text>
									<Pressable
										onPress={() => {
											handleCycleHistory('next');
										}}
										disabled={!hasHistory}
										style={{
											flex: 1,
											minHeight: 38,
											borderRadius: 10,
											borderWidth: 1,
											borderColor: theme.colors.border,
											alignItems: 'center',
											justifyContent: 'center',
											opacity: hasHistory ? 1 : 0.45,
										}}
									>
										<ChevronDown color={theme.colors.textSecondary} size={18} />
									</Pressable>
								</View>
							) : null}
							{history && historyPanelOpen ? (
								<View
									style={{
										marginTop: 10,
										borderTopWidth: 1,
										borderTopColor: theme.colors.border,
										paddingTop: 10,
									}}
								>
									<ScrollView
										style={{ maxHeight: 160 }}
										keyboardShouldPersistTaps="handled"
									>
										<HistorySection
											title="Pinned"
											entries={pinnedEntries}
											emptyText="No pinned text"
											theme={theme}
											onSelect={loadHistoryEntry}
											onTogglePin={handleToggleEntryPin}
											onDelete={handleDeleteHistoryEntry}
										/>
										<HistorySection
											title="Recent"
											entries={recentEntries}
											emptyText="No recent text"
											theme={theme}
											onSelect={loadHistoryEntry}
											onTogglePin={handleToggleEntryPin}
											onDelete={handleDeleteHistoryEntry}
										/>
									</ScrollView>
									<Pressable
										onPress={() => {
											history.onClearRecent();
											resetHistoryState();
										}}
										disabled={!recentEntries.length}
										accessibilityRole="button"
										accessibilityLabel="Clear Recent"
										style={{
											marginTop: 8,
											borderRadius: 10,
											borderWidth: 1,
											borderColor: theme.colors.border,
											paddingVertical: 10,
											alignItems: 'center',
											opacity: recentEntries.length ? 1 : 0.45,
										}}
									>
										<Text
											style={{
												color: theme.colors.textSecondary,
												fontWeight: '700',
											}}
										>
											Clear Recent
										</Text>
									</Pressable>
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

function HistorySection({
	title,
	entries,
	emptyText,
	theme,
	onSelect,
	onTogglePin,
	onDelete,
}: {
	title: string;
	entries: readonly TextEntryHistoryEntry[];
	emptyText: string;
	theme: ReturnType<typeof useTheme>;
	onSelect: (entry: TextEntryHistoryEntry) => void;
	onTogglePin: (entry: TextEntryHistoryEntry) => void;
	onDelete: (entry: TextEntryHistoryEntry) => void;
}) {
	return (
		<View style={{ marginBottom: 10 }}>
			<Text
				style={{
					color: theme.colors.textSecondary,
					fontSize: 12,
					fontWeight: '700',
					marginBottom: 6,
				}}
			>
				{title}
			</Text>
			{entries.length ? (
				entries.map((entry) => (
					<View
						key={entry.id}
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							borderBottomWidth: 1,
							borderBottomColor: theme.colors.border,
							paddingVertical: 6,
							gap: 8,
						}}
					>
						<Pressable
							onPress={() => {
								onSelect(entry);
							}}
							style={{ flex: 1, minHeight: 34, justifyContent: 'center' }}
						>
							<Text
								numberOfLines={2}
								style={{
									color: theme.colors.textPrimary,
									fontSize: 13,
									lineHeight: 18,
								}}
							>
								{entry.text}
							</Text>
						</Pressable>
						<Pressable
							onPress={() => {
								onTogglePin(entry);
							}}
							style={{
								width: 32,
								height: 32,
								borderRadius: 999,
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							{entry.pinned ? (
								<PinOff color={theme.colors.textSecondary} size={16} />
							) : (
								<Pin color={theme.colors.textSecondary} size={16} />
							)}
						</Pressable>
						<Pressable
							onPress={() => {
								onDelete(entry);
							}}
							style={{
								width: 32,
								height: 32,
								borderRadius: 999,
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							<Trash2 color={theme.colors.textSecondary} size={16} />
						</Pressable>
					</View>
				))
			) : (
				<Text
					style={{
						color: theme.colors.muted,
						fontSize: 13,
						paddingVertical: 6,
					}}
				>
					{emptyText}
				</Text>
			)}
		</View>
	);
}
