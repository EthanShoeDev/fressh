import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { type CommandPreset } from '@/lib/command-presets';
import { useTheme } from '@/lib/theme';

export function CommandPresetsModal({
	open,
	presets,
	bottomOffset,
	onClose,
	onSelect,
}: {
	open: boolean;
	presets: CommandPreset[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
}) {
	const theme = useTheme();
	const uniquePresets = useMemo(() => {
		const seen = new Set<string>();
		return presets.filter((preset) => {
			const key = preset.label.trim();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [presets]);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
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
							Command Presets
						</Text>
						<Pressable
							onPress={onClose}
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
									key={`${preset.label}-${index.toString()}`}
									onPress={() => onSelect(preset)}
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
										{preset.label}
									</Text>
								</Pressable>
							))}
						</ScrollView>
					)}
				</View>
			</Pressable>
		</Modal>
	);
}
