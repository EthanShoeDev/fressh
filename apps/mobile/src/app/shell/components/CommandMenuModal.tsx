import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { dispatchCommandMenuSelection } from '@/lib/command-menu-selection';
import { type ActionId } from '@/lib/keyboard-actions';
import {
	type CommandMenu,
	type CommandMenuEntry,
	type CommandPreset,
} from '@/lib/shell-config';
import { useTheme } from '@/lib/theme';

const isCommandMenu = (entry: CommandMenuEntry): entry is CommandMenu =>
	entry.type === 'submenu';

export function CommandMenuModal({
	open,
	entries,
	bottomOffset,
	onClose,
	onSelect,
	onAction,
}: {
	open: boolean;
	entries: CommandMenuEntry[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
	onAction: (actionId: ActionId) => void;
}) {
	const theme = useTheme();
	const [menuStack, setMenuStack] = useState<CommandMenu[]>([]);

	useEffect(() => {
		if (!open) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset navigation when parent closes the modal (e.g. after selecting a preset).
			setMenuStack([]);
		}
	}, [open]);

	const handleClose = () => {
		// Reset navigation state when the modal closes.
		setMenuStack([]);
		onClose();
	};

	const activeMenu = menuStack[menuStack.length - 1];
	const activeEntries = activeMenu?.entries ?? entries;
	const menuTitle = activeMenu?.label ?? 'Cmds';

	const uniqueEntries = useMemo(() => {
		const seen = new Set<string>();
		return activeEntries.filter((entry) => {
			const key = entry.label.trim();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [activeEntries]);

	const handleEntryPress = (entry: CommandMenuEntry) => {
		dispatchCommandMenuSelection(entry, {
			onSubmenu: (menu) => setMenuStack((current) => [...current, menu]),
			onPreset: (selectedPreset) => {
				// Ensure the next open starts at the root even if the parent closes the modal
				// as a side effect of selecting a preset.
				setMenuStack([]);
				onSelect(selectedPreset);
			},
			onClose: handleClose,
			onAction,
		});
	};

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
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '80%',
						width: '70%',
						maxWidth: 320,
						minWidth: 240,
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
							{menuTitle}
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
							<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
						</Pressable>
					</View>
					{uniqueEntries.length === 0 ? (
						<Text style={{ color: theme.colors.textSecondary }}>
							No commands configured.
						</Text>
					) : (
						<ScrollView>
							{uniqueEntries.map((entry, index) => (
								<Pressable
									key={`${entry.type}-${entry.label}-${index.toString()}`}
									onPress={() => handleEntryPress(entry)}
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
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											justifyContent: 'space-between',
										}}
									>
										<Text
											style={{
												color: theme.colors.textPrimary,
												fontSize: 14,
												fontWeight: '600',
											}}
										>
											{entry.label}
										</Text>
										{isCommandMenu(entry) ? (
											<Text
												style={{ color: theme.colors.textSecondary }}
											>{`>`}</Text>
										) : null}
									</View>
								</Pressable>
							))}
						</ScrollView>
					)}
				</View>
			</Pressable>
		</Modal>
	);
}
