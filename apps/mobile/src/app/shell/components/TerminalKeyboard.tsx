import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
	type KeyboardDefinition,
	type KeyboardSlot,
	type ModifierKey,
} from '@/generated/keyboard-config';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { useTheme } from '@/lib/theme';

export function TerminalKeyboard({
	keyboard,
	modifierKeysActive,
	onSlotPress,
	selectionModeEnabled,
	onCopySelection,
	onPasteClipboard,
	showSystemKeyboardToggle,
	systemKeyboardEnabled,
	onToggleSystemKeyboard,
}: {
	keyboard: KeyboardDefinition | null;
	modifierKeysActive: ModifierKey[];
	onSlotPress: (slot: KeyboardSlot) => void;
	selectionModeEnabled: boolean;
	onCopySelection: () => void;
	onPasteClipboard: () => void;
	showSystemKeyboardToggle: boolean;
	systemKeyboardEnabled: boolean;
	onToggleSystemKeyboard: () => void;
}) {
	const theme = useTheme();
	const KeyboardIcon = resolveLucideIcon('Keyboard');
	const CopyIcon = resolveLucideIcon('Copy');
	const PasteIcon = resolveLucideIcon('ClipboardPaste');

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
	const rows = keyboard.grid.map((row, rowIndex) => (
		<View key={`row-${rowIndex}`} style={{ flexDirection: 'row' }}>
			{row.map((slot, colIndex) => {
				if (!slot) {
					return (
						<View
							key={`slot-${rowIndex}-${colIndex}`}
							style={{ flex: 1, margin: 2 }}
						/>
					);
				}

				const modifierActive =
					slot.type === 'modifier' &&
					modifierKeysActive.includes(slot.modifier);
				const Icon = resolveLucideIcon(slot.icon);

				return (
					<Pressable
						key={`slot-${rowIndex}-${colIndex}`}
						onPress={() => onSlotPress(slot)}
						style={[
							{
								flex: 1,
								margin: 2,
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
						{Icon ? (
							<Icon color={theme.colors.textPrimary} size={18} />
						) : null}
						<Text
							numberOfLines={1}
							style={{
								color: theme.colors.textPrimary,
								fontSize: 10,
								marginTop: Icon ? 2 : 0,
							}}
						>
							{slot.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	));
	/* eslint-enable @eslint-react/no-array-index-key */

	const copyToggle = (
		<Pressable
			onPress={onCopySelection}
			style={{
				flex: 1,
				margin: 2,
				paddingVertical: 6,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{CopyIcon ? (
				<CopyIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: CopyIcon ? 2 : 0,
				}}
			>
				Copy
			</Text>
		</Pressable>
	);

	const pasteToggle = (
		<Pressable
			onPress={onPasteClipboard}
			style={{
				flex: 1,
				margin: 2,
				paddingVertical: 6,
				borderRadius: 8,
				borderWidth: 1,
				borderColor: theme.colors.border,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{PasteIcon ? (
				<PasteIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: PasteIcon ? 2 : 0,
				}}
			>
				Paste
			</Text>
		</Pressable>
	);

	const systemKeyboardToggle = showSystemKeyboardToggle ? (
		<Pressable
			onPress={onToggleSystemKeyboard}
			style={[
				{
					flex: 1,
					margin: 2,
					paddingVertical: 6,
					borderRadius: 8,
					borderWidth: 1,
					borderColor: theme.colors.border,
					alignItems: 'center',
					justifyContent: 'center',
				},
				systemKeyboardEnabled && { backgroundColor: theme.colors.primary },
			]}
		>
			{KeyboardIcon ? (
				<KeyboardIcon color={theme.colors.textPrimary} size={18} />
			) : null}
			<Text
				numberOfLines={1}
				style={{
					color: theme.colors.textPrimary,
					fontSize: 10,
					marginTop: KeyboardIcon ? 2 : 0,
				}}
			>
				OS Keyboard
			</Text>
		</Pressable>
	) : null;

	const toggleRow =
		selectionModeEnabled || showSystemKeyboardToggle ? (
			<View style={{ flexDirection: 'row' }}>
				{selectionModeEnabled ? copyToggle : null}
				{selectionModeEnabled ? pasteToggle : null}
				{systemKeyboardToggle}
			</View>
		) : null;

	return (
		<View
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
			}}
		>
			{toggleRow}
			{rows}
		</View>
	);
}
