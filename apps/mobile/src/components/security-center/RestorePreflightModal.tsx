import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

export function RestorePreflightModal(props: {
	open: boolean;
	keys: Array<{ id: string; label: string }>;
	connections: Array<{ id: string; label: string }>;
	isRestoring: boolean;
	onClose: () => void;
	onConfirm: () => void;
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
							Replace This Device?
						</Text>
						<Pressable
							onPress={props.onClose}
							disabled={props.isRestoring}
							style={{
								paddingHorizontal: 8,
								paddingVertical: 6,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: theme.colors.border,
								opacity: props.isRestoring ? 0.6 : 1,
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
					<Text
						style={{
							color: theme.colors.textSecondary,
							marginBottom: 12,
						}}
					>
						Review the keys and saved connections that will replace the current
						device state.
					</Text>
					<ScrollView contentContainerStyle={{ gap: 16 }}>
						<RestoreSection title="Keys to replace" items={props.keys} />
						<RestoreSection
							title="Saved connections to replace"
							items={props.connections}
						/>
					</ScrollView>
					<View
						style={{
							flexDirection: 'row',
							gap: 12,
							marginTop: 16,
						}}
					>
						<Pressable
							onPress={props.onClose}
							disabled={props.isRestoring}
							style={{
								flex: 1,
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 10,
								paddingVertical: 12,
								alignItems: 'center',
								opacity: props.isRestoring ? 0.6 : 1,
							}}
						>
							<Text style={{ color: theme.colors.textSecondary }}>Cancel</Text>
						</Pressable>
						<Pressable
							onPress={props.onConfirm}
							disabled={props.isRestoring}
							style={{
								flex: 1,
								backgroundColor: theme.colors.danger,
								borderRadius: 10,
								paddingVertical: 12,
								alignItems: 'center',
								opacity: props.isRestoring ? 0.6 : 1,
							}}
						>
							<Text style={{ color: theme.colors.buttonTextOnPrimary }}>
								{props.isRestoring ? 'Replacing…' : 'Replace'}
							</Text>
						</Pressable>
					</View>
				</View>
			</View>
		</Modal>
	);
}

function RestoreSection(props: {
	title: string;
	items: Array<{ id: string; label: string }>;
}) {
	const theme = useTheme();

	return (
		<View style={{ gap: 8 }}>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontWeight: '700',
					fontSize: 16,
				}}
			>
				{props.title}
			</Text>
			<View style={{ gap: 8 }}>
				{props.items.length > 0 ? (
					props.items.map((item) => (
						<View
							key={item.id}
							style={{
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 10,
								padding: 12,
								backgroundColor: theme.colors.surface,
							}}
						>
							<Text style={{ color: theme.colors.textPrimary }}>
								{item.label}
							</Text>
						</View>
					))
				) : (
					<Text style={{ color: theme.colors.textSecondary }}>None</Text>
				)}
			</View>
		</View>
	);
}
