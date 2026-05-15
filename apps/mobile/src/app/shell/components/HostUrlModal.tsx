import React, { useCallback, useEffect, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

export type HostUrlModalMode = 'open-missing' | 'edit';

export function HostUrlModal({
	open,
	bottomOffset,
	slotLabel,
	initialValue,
	mode,
	isSubmitting,
	error,
	onClose,
	onSubmit,
}: {
	open: boolean;
	bottomOffset: number;
	slotLabel: string;
	initialValue: string;
	mode: HostUrlModalMode;
	isSubmitting: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (value: string) => void;
}) {
	const theme = useTheme();
	const [value, setValue] = useState(initialValue);

	useEffect(() => {
		if (!open) return;
		setValue(initialValue);
	}, [initialValue, open]);

	const handleSubmit = useCallback(() => {
		if (isSubmitting) return;
		onSubmit(value);
	}, [isSubmitting, onSubmit, value]);

	const actionLabel = mode === 'open-missing' ? 'Save & Open' : 'Save';

	return (
		<Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{
						flex: 1,
						justifyContent: 'center',
						paddingBottom: bottomOffset,
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
							width: '85%',
							maxWidth: 400,
							minWidth: 280,
							alignSelf: 'flex-end',
							marginRight: 8,
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
								{mode === 'open-missing'
									? `Set ${slotLabel} URL`
									: `Edit ${slotLabel} URL`}
							</Text>
							<Pressable
								onPress={onClose}
								disabled={isSubmitting}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>Cancel</Text>
							</Pressable>
						</View>

						<Text
							style={{
								color: theme.colors.textSecondary,
								fontSize: 14,
								fontWeight: '600',
								marginBottom: 6,
							}}
						>
							URL
						</Text>
						<TextInput
							value={value}
							onChangeText={setValue}
							placeholder="https://example.com"
							placeholderTextColor={theme.colors.muted}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
							editable={!isSubmitting}
							style={{
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.inputBackground,
								color: theme.colors.textPrimary,
								borderRadius: 10,
								paddingHorizontal: 12,
								paddingVertical: 10,
								marginBottom: 12,
							}}
						/>
						{error ? (
							<Text
								style={{
									color: theme.colors.danger,
									fontSize: 12,
									fontWeight: '600',
									marginBottom: 12,
								}}
							>
								{error}
							</Text>
						) : null}
						<Pressable
							onPress={handleSubmit}
							disabled={isSubmitting}
							style={{
								backgroundColor: isSubmitting
									? theme.colors.border
									: theme.colors.primary,
								borderRadius: 10,
								paddingVertical: 12,
								alignItems: 'center',
								flexDirection: 'row',
								justifyContent: 'center',
							}}
						>
							{isSubmitting ? (
								<ActivityIndicator
									size="small"
									color={theme.colors.buttonTextOnPrimary}
									style={{ marginRight: 8 }}
								/>
							) : null}
							<Text
								style={{
									color: theme.colors.buttonTextOnPrimary,
									fontWeight: '700',
								}}
							>
								{isSubmitting ? 'Saving...' : actionLabel}
							</Text>
						</Pressable>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
