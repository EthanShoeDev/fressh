import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import {
	type KeyboardDefinition,
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
	onSlotPress: (slot: KeyboardSlot) => void;
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
				slot.type === 'modifier' &&
				modifierKeysActive.includes(slot.modifier);
			const Icon = resolveLucideIcon(effectiveIconName);
			const showLabel = !(Icon && iconOnlyLabels.has(effectiveLabel));
			const isRepeatable =
				slot.type === 'bytes' && repeatableLabels.has(slot.label);

			cells.push(
				<Pressable
					key={`slot-${rowIndex}-${col}`}
					onPress={
						isRepeatable
							? undefined
							: isSelectionCopySlot
								? onCopySelection
								: () => onSlotPress(slot)
					}
					onPressIn={isRepeatable ? () => startRepeat(slot) : undefined}
					onPressOut={isRepeatable ? clearRepeat : undefined}
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
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
			}}
		>
			{rows}
		</View>
	);
}
