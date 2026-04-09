import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

export function KeyPickerSheet(props: {
	open: boolean;
	keys: Array<{
		id: string;
		metadata: { label?: string; isDefault?: boolean };
	}>;
	selectedId: string;
	onClose: () => void;
	onSelect: (id: string) => void;
	onManagePress: () => void;
}) {
	const theme = useTheme();

	return (
		<Modal
			visible={props.open}
			transparent
			animationType="slide"
			onRequestClose={props.onClose}
		>
			<View
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
				}}
			>
				<View
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						borderTopRightRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '85%',
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							justifyContent: 'space-between',
							alignItems: 'center',
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
							Select Key
						</Text>
						<Pressable
							onPress={props.onClose}
							style={{
								paddingHorizontal: 8,
								paddingVertical: 6,
								borderRadius: 8,
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
					<ScrollView contentContainerStyle={{ gap: 8 }}>
						{props.keys.map((key) => {
							const isSelected = key.id === props.selectedId;
							return (
								<Pressable
									key={key.id}
									testID={`select-key-${key.id}`}
									onPress={() => props.onSelect(key.id)}
									style={{
										borderWidth: 1,
										borderColor: isSelected
											? theme.colors.primary
											: theme.colors.border,
										borderRadius: 10,
										padding: 12,
										backgroundColor: isSelected
											? theme.colors.inputBackground
											: theme.colors.background,
									}}
								>
									<Text style={{ color: theme.colors.textPrimary }}>
										{key.metadata.label ?? key.id}
									</Text>
								</Pressable>
							);
						})}
						<Pressable
							testID="open-security-center"
							onPress={props.onManagePress}
							style={{
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 10,
								padding: 12,
							}}
						>
							<Text style={{ color: theme.colors.textSecondary }}>
								Manage in Security Center
							</Text>
						</Pressable>
					</ScrollView>
				</View>
			</View>
		</Modal>
	);
}
