import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	type CommandPreset,
	type CommandPresetEntry,
	type CommandPresetMenu,
} from '@/lib/shell-config';
import { useTheme } from '@/lib/theme';

const isCommandPresetMenu = (
	preset: CommandPresetEntry,
): preset is CommandPresetMenu => preset.type === 'submenu';

export function CommandPresetsModal({
	open,
	presets,
	bottomOffset,
	onClose,
	onSelect,
}: {
	open: boolean;
	presets: CommandPresetEntry[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
}) {
	const theme = useTheme();
	const [menuStack, setMenuStack] = useState<CommandPresetMenu[]>([]);

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
	const activePresets = activeMenu?.presets ?? presets;
	const menuTitle = activeMenu?.label ?? 'Command Presets';

	const uniquePresets = useMemo(() => {
		const seen = new Set<string>();
		return activePresets.filter((preset) => {
			const key = preset.label.trim();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [activePresets]);

	const handlePresetPress = (preset: CommandPresetEntry) => {
		if (isCommandPresetMenu(preset)) {
			setMenuStack((current) => [...current, preset]);
			return;
		}
		// Ensure the next open starts at the root even if the parent closes the modal
		// as a side effect of selecting a preset.
		setMenuStack([]);
		onSelect(preset);
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
					{uniquePresets.length === 0 ? (
						<Text style={{ color: theme.colors.textSecondary }}>
							No command presets configured.
						</Text>
					) : (
						<ScrollView>
							{uniquePresets.map((preset, index) => (
								<Pressable
									key={`${preset.type}-${preset.label}-${index.toString()}`}
									onPress={() => handlePresetPress(preset)}
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
											{preset.label}
										</Text>
										{isCommandPresetMenu(preset) ? (
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
