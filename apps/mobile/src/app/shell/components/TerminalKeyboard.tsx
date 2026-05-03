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
	getLongPressOptionIndexAtPoint,
	getLongPressPopupLayout,
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
	const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const repeatSlotRef = useRef<KeyboardSlot | null>(null);
	const keyboardRootRef = useRef<View | null>(null);
	const keyboardRootWindowRef = useRef({ x: 0, y: 0 });
	const keyboardWidthRef = useRef(0);
	const suppressNextPressRef = useRef(false);
	const activeLongPressSlotRef = useRef<KeyboardSlot | null>(null);
	const [longPressPopup, setLongPressPopup] = useState<{
		slot: KeyboardSlot;
		options: readonly KeyboardLongPressOption[];
		layout: LongPressPopupLayout;
		highlightedIndex: number | null;
	} | null>(null);
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

	useEffect(() => clearRepeat, [clearRepeat]);

	const closeLongPressPopup = useCallback(() => {
		activeLongPressSlotRef.current = null;
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
		(event: GestureResponderEvent) => {
			setLongPressPopup((current) => {
				if (!current) return current;
				const { localX, localY } = getLocalPoint(event);
				const highlightedIndex = getLongPressOptionIndexAtPoint({
					layout: current.layout,
					localX,
					localY,
				});
				if (highlightedIndex === current.highlightedIndex) return current;
				return { ...current, highlightedIndex };
			});
		},
		[getLocalPoint],
	);

	const openLongPressPopup = useCallback(
		(slot: KeyboardSlot, keyRef: React.RefObject<View | null>) => {
			const options = slot.longPress?.options;
			if (!options?.length) return;

			clearRepeat();
			suppressNextPressRef.current = true;
			activeLongPressSlotRef.current = slot;
			updateKeyboardRootMetrics();
			keyRef.current?.measureInWindow((x, y, width) => {
				const root = keyboardRootWindowRef.current;
				const layout = getLongPressPopupLayout({
					keyboardWidth: keyboardWidthRef.current,
					anchorX: x - root.x,
					anchorY: y - root.y,
					anchorWidth: width,
					optionCount: options.length,
				});
				setLongPressPopup({
					slot,
					options,
					layout,
					highlightedIndex: null,
				});
			});
		},
		[clearRepeat, updateKeyboardRootMetrics],
	);

	const releaseLongPressPopup = useCallback(
		(event: GestureResponderEvent) => {
			const current = longPressPopup;
			if (!current) return false;
			const { localX, localY } = getLocalPoint(event);
			const optionIndex = getLongPressOptionIndexAtPoint({
				layout: current.layout,
				localX,
				localY,
			});
			suppressNextPressRef.current = false;
			closeLongPressPopup();
			if (optionIndex == null) return true;
			const option = current.options[optionIndex];
			if (option) onSlotPress(option);
			return true;
		},
		[closeLongPressPopup, getLocalPoint, longPressPopup, onSlotPress],
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
			const Icon = resolveLucideIcon(effectiveIconName);
			const showLabel = !(Icon && iconOnlyLabels.has(effectiveLabel));
			const keyRef = React.createRef<View>();
			const hasLongPressOptions = Boolean(slot.longPress?.options.length);
			const isRepeatable =
				!hasLongPressOptions &&
				slot.type === 'bytes' &&
				repeatableLabels.has(slot.label);

			cells.push(
				<Pressable
					key={`slot-${rowIndex}-${col}`}
					ref={keyRef}
					onPress={
						isRepeatable || hasLongPressOptions
							? undefined
							: isSelectionCopySlot
								? onCopySelection
								: () => onSlotPress(slot)
					}
					onLongPress={
						hasLongPressOptions
							? () => openLongPressPopup(slot, keyRef)
							: undefined
					}
					onPressIn={isRepeatable ? () => startRepeat(slot) : undefined}
					onPressOut={(event) => {
						if (releaseLongPressPopup(event)) return;
						if (isRepeatable) clearRepeat();
						if (hasLongPressOptions) {
							if (suppressNextPressRef.current) {
								suppressNextPressRef.current = false;
								return;
							}
							if (isSelectionCopySlot) {
								onCopySelection();
								return;
							}
							onSlotPress(slot);
						}
					}}
					onTouchMove={
						hasLongPressOptions ? updateLongPressHighlight : undefined
					}
					style={[
						{
							flex: span,
							margin: 2,
							height: keyHeight,
							paddingVertical: 6,
							borderRadius: 8,
							borderWidth: 1,
							borderColor: theme.colors.border,
							alignItems: 'center',
							justifyContent: 'center',
						},
						modifierActive && {
							backgroundColor: theme.colors.primary,
						},
					]}
				>
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
				</Pressable>,
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
