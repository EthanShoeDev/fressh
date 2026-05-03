import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Pressable,
	type GestureResponderEvent,
	type LayoutChangeEvent,
	Text,
	View,
} from 'react-native';
import {
	getLongPressMoveState,
	getLongPressOptionIndexAtPoint,
	getLongPressPopupLayout,
	getLongPressReleaseDecision,
	type LongPressPopupLayout,
} from '@/lib/keyboard-long-press';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import {
	type KeyboardDefinition,
	type KeyboardExecutableItem,
	type KeyboardLongPressOption,
	type KeyboardSlot,
	type ModifierKey,
} from '@/lib/shell-config';
import { useTheme } from '@/lib/theme';

type LongPressPopupState = {
	slot: KeyboardSlot;
	options: readonly KeyboardLongPressOption[];
	layout: LongPressPopupLayout;
	highlightedIndex: number | null;
};

type LongPressGestureState = {
	slot: KeyboardSlot;
	keyRef: React.RefObject<View | null>;
	startPageX: number;
	startPageY: number;
	currentPageX: number;
	currentPageY: number;
	movedBeyondTapSlop: boolean;
	longPressFired: boolean;
};

type KeyboardTheme = ReturnType<typeof useTheme>;

function TerminalKeyboardKey({
	slot,
	span,
	keyHeight,
	theme,
	iconOnlyLabels,
	effectiveLabel,
	effectiveIconName,
	modifierActive,
	hasLongPressOptions,
	isRepeatable,
	isSelectionCopySlot,
	onSlotPress,
	onCopySelection,
	startRepeat,
	clearRepeat,
	startLongPressGesture,
	moveLongPressGesture,
	releaseLongPressGesture,
	cancelLongPressGesture,
	runMainSlot,
}: {
	slot: KeyboardSlot;
	span: number;
	keyHeight: number;
	theme: KeyboardTheme;
	iconOnlyLabels: ReadonlySet<string>;
	effectiveLabel: string;
	effectiveIconName: string | null;
	modifierActive: boolean;
	hasLongPressOptions: boolean;
	isRepeatable: boolean;
	isSelectionCopySlot: boolean;
	onSlotPress: (slot: KeyboardExecutableItem) => void;
	onCopySelection: () => void;
	startRepeat: (slot: KeyboardSlot) => void;
	clearRepeat: () => void;
	startLongPressGesture: (
		slot: KeyboardSlot,
		keyRef: React.RefObject<View | null>,
		event: GestureResponderEvent,
	) => void;
	moveLongPressGesture: (event: GestureResponderEvent) => void;
	releaseLongPressGesture: (
		slot: KeyboardSlot,
		isSelectionCopySlot: boolean,
		event: GestureResponderEvent,
	) => void;
	cancelLongPressGesture: () => void;
	runMainSlot: (slot: KeyboardSlot, isSelectionCopySlot: boolean) => void;
}) {
	const keyRef = useRef<View | null>(null);
	const Icon = resolveLucideIcon(effectiveIconName);
	const showLabel = !(Icon && iconOnlyLabels.has(effectiveLabel));
	const keyStyle = [
		{
			flex: span,
			margin: 2,
			height: keyHeight,
			paddingVertical: 6,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: theme.colors.border,
			alignItems: 'center' as const,
			justifyContent: 'center' as const,
		},
		modifierActive && {
			backgroundColor: theme.colors.primary,
		},
	];
	const keyContent = (
		<>
			{Icon ? <Icon color={theme.colors.textPrimary} size={18} /> : null}
			{showLabel ? (
				<Text
					numberOfLines={1}
					style={{
						color: theme.colors.textPrimary,
						fontSize: 10,
						lineHeight: 12,
						marginTop: Icon ? 2 : 0,
					}}
				>
					{effectiveLabel}
				</Text>
			) : null}
			{hasLongPressOptions ? (
				<View
					style={{
						position: 'absolute',
						top: 4,
						right: 4,
						width: 5,
						height: 5,
						borderRadius: 3,
						backgroundColor: theme.colors.textSecondary,
						opacity: 0.75,
					}}
				/>
			) : null}
		</>
	);

	if (hasLongPressOptions) {
		return (
			<View
				ref={keyRef}
				accessible
				accessibilityRole="button"
				accessibilityLabel={effectiveLabel}
				onAccessibilityTap={() => runMainSlot(slot, isSelectionCopySlot)}
				onStartShouldSetResponder={() => true}
				onResponderGrant={(event) => startLongPressGesture(slot, keyRef, event)}
				onResponderMove={moveLongPressGesture}
				onResponderRelease={(event) =>
					releaseLongPressGesture(slot, isSelectionCopySlot, event)
				}
				onResponderTerminate={cancelLongPressGesture}
				onResponderTerminationRequest={() => false}
				style={keyStyle}
			>
				{keyContent}
			</View>
		);
	}

	return (
		<Pressable
			ref={keyRef}
			onPress={
				isRepeatable
					? undefined
					: isSelectionCopySlot
						? onCopySelection
						: () => onSlotPress(slot)
			}
			onPressIn={isRepeatable ? () => startRepeat(slot) : undefined}
			onPressOut={isRepeatable ? clearRepeat : undefined}
			style={keyStyle}
		>
			{keyContent}
		</Pressable>
	);
}

export function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
	selectionModeEnabled,
	onCopySelection,
}: {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardExecutableItem) => void;
	selectionModeEnabled: boolean;
	onCopySelection: () => void;
}) {
	const theme = useTheme();
	// Fixed key height keeps all rows visually consistent even when some keys
	// render an icon+label stack and others are label-only.
	const keyHeight = 48;
	const repeatDelayMs = 320;
	const repeatIntervalMs = 70;
	const longPressDelayMs = 500;
	const tapSlopPx = 8;
	const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const repeatSlotRef = useRef<KeyboardSlot | null>(null);
	const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const longPressGestureRef = useRef<LongPressGestureState | null>(null);
	const keyboardRootRef = useRef<View | null>(null);
	const keyboardRootWindowRef = useRef({ x: 0, y: 0 });
	const keyboardWidthRef = useRef(0);
	const longPressPopupRef = useRef<LongPressPopupState | null>(null);
	const [longPressPopup, setLongPressPopup] =
		useState<LongPressPopupState | null>(null);
	const iconOnlyLabels = useMemo(
		() =>
			new Set([
				'ARROW_LEFT',
				'ARROW_RIGHT',
				'ARROW_UP',
				'ARROW_DOWN',
				'PAGE_UP',
				'PAGE_DOWN',
			]),
		[],
	);
	const repeatableLabels = useMemo(
		() => new Set(['ARROW_LEFT', 'ARROW_RIGHT', 'ARROW_UP', 'ARROW_DOWN']),
		[],
	);

	const clearRepeat = useCallback(() => {
		if (repeatTimeoutRef.current) {
			clearTimeout(repeatTimeoutRef.current);
			repeatTimeoutRef.current = null;
		}
		if (repeatIntervalRef.current) {
			clearInterval(repeatIntervalRef.current);
			repeatIntervalRef.current = null;
		}
		repeatSlotRef.current = null;
	}, []);

	const clearLongPressTimer = useCallback(() => {
		if (longPressTimeoutRef.current) {
			clearTimeout(longPressTimeoutRef.current);
			longPressTimeoutRef.current = null;
		}
	}, []);

	const startRepeat = useCallback(
		(slot: KeyboardSlot) => {
			clearRepeat();
			repeatSlotRef.current = slot;
			onSlotPress(slot);
			repeatTimeoutRef.current = setTimeout(() => {
				repeatIntervalRef.current = setInterval(() => {
					if (repeatSlotRef.current) {
						onSlotPress(repeatSlotRef.current);
					}
				}, repeatIntervalMs);
			}, repeatDelayMs);
		},
		[clearRepeat, onSlotPress, repeatDelayMs, repeatIntervalMs],
	);

	useEffect(
		() => () => {
			clearRepeat();
			clearLongPressTimer();
		},
		[clearLongPressTimer, clearRepeat],
	);

	const closeLongPressPopup = useCallback(() => {
		longPressPopupRef.current = null;
		setLongPressPopup(null);
	}, []);

	const updateKeyboardRootMetrics = useCallback(() => {
		keyboardRootRef.current?.measureInWindow((x, y, width) => {
			keyboardRootWindowRef.current = { x, y };
			keyboardWidthRef.current = width;
		});
	}, []);

	const handleKeyboardLayout = useCallback(
		(_event: LayoutChangeEvent) => {
			updateKeyboardRootMetrics();
		},
		[updateKeyboardRootMetrics],
	);

	const getLocalPoint = useCallback((event: GestureResponderEvent) => {
		return {
			localX: event.nativeEvent.pageX - keyboardRootWindowRef.current.x,
			localY: event.nativeEvent.pageY - keyboardRootWindowRef.current.y,
		};
	}, []);

	const updateLongPressHighlight = useCallback(
		({ localX, localY }: { localX: number; localY: number }) => {
			setLongPressPopup((current) => {
				if (!current) return current;
				const highlightedIndex = getLongPressOptionIndexAtPoint({
					layout: current.layout,
					localX,
					localY,
				});
				if (highlightedIndex === current.highlightedIndex) {
					longPressPopupRef.current = current;
					return current;
				}
				const next = { ...current, highlightedIndex };
				longPressPopupRef.current = next;
				return next;
			});
		},
		[],
	);

	const openLongPressPopup = useCallback(
		(slot: KeyboardSlot, keyRef: React.RefObject<View | null>) => {
			const options = slot.longPress?.options;
			if (!options?.length) return;

			clearRepeat();
			updateKeyboardRootMetrics();
			keyRef.current?.measureInWindow((x, y, width) => {
				const gesture = longPressGestureRef.current;
				if (
					!gesture ||
					gesture.slot !== slot ||
					gesture.keyRef !== keyRef ||
					!gesture.longPressFired
				) {
					return;
				}
				const root = keyboardRootWindowRef.current;
				const layout = getLongPressPopupLayout({
					keyboardWidth: keyboardWidthRef.current,
					anchorX: x - root.x,
					anchorY: y - root.y,
					anchorWidth: width,
					optionCount: options.length,
				});
				const nextPopup = {
					slot,
					options,
					layout,
					highlightedIndex: getLongPressOptionIndexAtPoint({
						layout,
						localX: gesture.currentPageX - root.x,
						localY: gesture.currentPageY - root.y,
					}),
				};
				longPressPopupRef.current = nextPopup;
				setLongPressPopup(nextPopup);
			});
		},
		[clearRepeat, updateKeyboardRootMetrics],
	);

	const startLongPressGesture = useCallback(
		(
			slot: KeyboardSlot,
			keyRef: React.RefObject<View | null>,
			event: GestureResponderEvent,
		) => {
			clearLongPressTimer();
			closeLongPressPopup();
			longPressGestureRef.current = {
				slot,
				keyRef,
				startPageX: event.nativeEvent.pageX,
				startPageY: event.nativeEvent.pageY,
				currentPageX: event.nativeEvent.pageX,
				currentPageY: event.nativeEvent.pageY,
				movedBeyondTapSlop: false,
				longPressFired: false,
			};
			longPressTimeoutRef.current = setTimeout(() => {
				const current = longPressGestureRef.current;
				if (!current || current.slot !== slot || current.keyRef !== keyRef) {
					return;
				}
				current.longPressFired = true;
				openLongPressPopup(slot, keyRef);
			}, longPressDelayMs);
		},
		[
			clearLongPressTimer,
			closeLongPressPopup,
			longPressDelayMs,
			openLongPressPopup,
		],
	);

	const moveLongPressGesture = useCallback(
		(event: GestureResponderEvent) => {
			const gesture = longPressGestureRef.current;
			if (!gesture) return;
			gesture.currentPageX = event.nativeEvent.pageX;
			gesture.currentPageY = event.nativeEvent.pageY;

			if (gesture.longPressFired) {
				updateLongPressHighlight(getLocalPoint(event));
				return;
			}

			const next = getLongPressMoveState({
				longPressFired: gesture.longPressFired,
				movedBeyondTapSlop: gesture.movedBeyondTapSlop,
				startPageX: gesture.startPageX,
				startPageY: gesture.startPageY,
				currentPageX: gesture.currentPageX,
				currentPageY: gesture.currentPageY,
				tapSlopPx,
			});
			gesture.movedBeyondTapSlop = next.movedBeyondTapSlop;
		},
		[getLocalPoint, tapSlopPx, updateLongPressHighlight],
	);

	const releaseLongPressGesture = useCallback(
		(
			slot: KeyboardSlot,
			isSelectionCopySlot: boolean,
			event: GestureResponderEvent,
		) => {
			const gesture = longPressGestureRef.current;
			longPressGestureRef.current = null;
			clearLongPressTimer();

			if (!gesture) {
				closeLongPressPopup();
				return;
			}

			const current = longPressPopupRef.current;
			const decision = getLongPressReleaseDecision({
				longPressFired: gesture.longPressFired,
				movedBeyondTapSlop: gesture.movedBeyondTapSlop,
				startPageX: gesture.startPageX,
				startPageY: gesture.startPageY,
				releasePageX: event.nativeEvent.pageX,
				releasePageY: event.nativeEvent.pageY,
				tapSlopPx,
				rootX: keyboardRootWindowRef.current.x,
				rootY: keyboardRootWindowRef.current.y,
				popupLayout: current?.layout ?? null,
				highlightedIndex: current?.highlightedIndex ?? null,
			});
			closeLongPressPopup();

			if (decision.type === 'cancel') {
				return;
			}
			if (decision.type === 'option') {
				const option = current?.options[decision.optionIndex];
				if (option) onSlotPress(option);
				return;
			}
			if (isSelectionCopySlot) {
				onCopySelection();
				return;
			}
			onSlotPress(slot);
		},
		[
			clearLongPressTimer,
			closeLongPressPopup,
			onCopySelection,
			onSlotPress,
			tapSlopPx,
		],
	);

	const cancelLongPressGesture = useCallback(() => {
		longPressGestureRef.current = null;
		clearLongPressTimer();
		closeLongPressPopup();
	}, [clearLongPressTimer, closeLongPressPopup]);

	const runMainSlot = useCallback(
		(slot: KeyboardSlot, isSelectionCopySlot: boolean) => {
			if (isSelectionCopySlot) {
				onCopySelection();
				return;
			}
			onSlotPress(slot);
		},
		[onCopySelection, onSlotPress],
	);

	if (!keyboard) {
		return (
			<View
				style={{
					borderTopWidth: 1,
					borderColor: theme.colors.border,
					padding: 12,
				}}
			>
				<Text style={{ color: theme.colors.textSecondary }}>
					No keyboard configuration. Generate code to enable shortcuts.
				</Text>
			</View>
		);
	}

	/* eslint-disable @eslint-react/no-array-index-key */
	const visibleGrid = keyboard.grid.filter((row) =>
		row.some((slot) => slot !== null),
	);
	const rows = visibleGrid.map((row, rowIndex) => {
		const cells = [];
		let col = 0;
		while (col < row.length) {
			const slot = row[col];
			const rawSpan =
				typeof slot?.span === 'number' && slot.span > 1 ? slot.span : 1;
			const span = Math.min(rawSpan, row.length - col);

			if (!slot) {
				cells.push(
					<View
						key={`slot-${rowIndex}-${col}`}
						style={{ flex: 1, margin: 2, height: keyHeight }}
					/>,
				);
				col += 1;
				continue;
			}

			const isSelectionCopySlot =
				selectionModeEnabled &&
				slot.type === 'action' &&
				slot.actionId === 'PASTE_CLIPBOARD';
			const effectiveLabel = isSelectionCopySlot ? 'Copy' : slot.label;
			const effectiveIconName = isSelectionCopySlot ? 'Copy' : slot.icon;
			const modifierActive =
				slot.type === 'modifier' && modifierKeysActive.includes(slot.modifier);
			const hasLongPressOptions = Boolean(slot.longPress?.options.length);
			const isRepeatable =
				!hasLongPressOptions &&
				slot.type === 'bytes' &&
				repeatableLabels.has(slot.label);

			cells.push(
				<TerminalKeyboardKey
					key={`slot-${rowIndex}-${col}`}
					slot={slot}
					span={span}
					keyHeight={keyHeight}
					theme={theme}
					iconOnlyLabels={iconOnlyLabels}
					effectiveLabel={effectiveLabel}
					effectiveIconName={effectiveIconName}
					modifierActive={modifierActive}
					hasLongPressOptions={hasLongPressOptions}
					isRepeatable={isRepeatable}
					isSelectionCopySlot={isSelectionCopySlot}
					onSlotPress={onSlotPress}
					onCopySelection={onCopySelection}
					startRepeat={startRepeat}
					clearRepeat={clearRepeat}
					startLongPressGesture={startLongPressGesture}
					moveLongPressGesture={moveLongPressGesture}
					releaseLongPressGesture={releaseLongPressGesture}
					cancelLongPressGesture={cancelLongPressGesture}
					runMainSlot={runMainSlot}
				/>,
			);

			col += span;
		}

		return (
			<View key={`row-${rowIndex}`} style={{ flexDirection: 'row' }}>
				{cells}
			</View>
		);
	});
	/* eslint-enable @eslint-react/no-array-index-key */

	return (
		<View
			ref={keyboardRootRef}
			onLayout={handleKeyboardLayout}
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
				position: 'relative',
			}}
		>
			{rows}
			{longPressPopup ? (
				<View
					pointerEvents="none"
					style={{
						position: 'absolute',
						left: longPressPopup.layout.left,
						top: longPressPopup.layout.top,
						width: longPressPopup.layout.width,
						height: longPressPopup.layout.height,
						flexDirection: 'row',
						borderRadius: 8,
						borderWidth: 1,
						borderColor: theme.colors.borderStrong,
						backgroundColor: theme.colors.surface,
						overflow: 'hidden',
						shadowColor: '#000',
						shadowOpacity: 0.25,
						shadowRadius: 8,
						shadowOffset: { width: 0, height: 3 },
						elevation: 6,
					}}
				>
					{longPressPopup.options.map((option, index) => {
						const OptionIcon = resolveLucideIcon(option.icon);
						const highlighted = longPressPopup.highlightedIndex === index;
						return (
							<View
								key={`${option.type}-${option.label}-${index.toString()}`}
								style={{
									width: longPressPopup.layout.optionWidth,
									alignItems: 'center',
									justifyContent: 'center',
									paddingHorizontal: 6,
									backgroundColor: highlighted
										? theme.colors.primary
										: 'transparent',
								}}
							>
								{OptionIcon ? (
									<OptionIcon color={theme.colors.textPrimary} size={16} />
								) : null}
								<Text
									numberOfLines={1}
									style={{
										color: theme.colors.textPrimary,
										fontSize: 10,
										lineHeight: 12,
										marginTop: OptionIcon ? 2 : 0,
									}}
								>
									{option.label}
								</Text>
							</View>
						);
					})}
				</View>
			) : null}
		</View>
	);
}
