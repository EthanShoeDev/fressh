import React, { useCallback, useEffect, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

export function FeatureRequestModal({
	open,
	bottomOffset,
	onClose,
	onSubmit,
	targetRepository,
	isResolvingTarget = false,
	isSubmitting = false,
	error,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => boolean | void;
	onSubmit: (description: string) => void;
	targetRepository?: string | null;
	isResolvingTarget?: boolean;
	isSubmitting?: boolean;
	error?: string;
}) {
	const theme = useTheme();
	const [description, setDescription] = useState('');

	useEffect(() => {
		if (!open) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset draft text when parent closes the modal.
			setDescription('');
		}
	}, [open]);

	const handleClose = useCallback(() => {
		if (isSubmitting) return;
		const didClose = onClose();
		if (didClose === false) return;
		setDescription('');
	}, [isSubmitting, onClose]);

	const handleSubmit = useCallback(() => {
		if (!description.trim() || isSubmitting) return;
		onSubmit(description.trim());
	}, [description, isSubmitting, onSubmit]);

	const canSubmit =
		description.trim().length > 0 &&
		!isSubmitting &&
		!isResolvingTarget &&
		targetRepository != null;

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
							maxHeight: '85%',
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
								Request a Feature
							</Text>
							<Pressable
								onPress={handleClose}
								disabled={isSubmitting}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text
									style={{
										color: isSubmitting
											? theme.colors.muted
											: theme.colors.textSecondary,
									}}
								>
									Cancel
								</Text>
							</Pressable>
						</View>
						<ScrollView keyboardShouldPersistTaps="handled">
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Description
							</Text>
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
									marginBottom: 8,
								}}
							>
								{isResolvingTarget
									? 'Resolving target repository...'
									: targetRepository
										? `Target: ${targetRepository}`
										: 'Target repository unavailable.'}
							</Text>
							<TextInput
								value={description}
								onChangeText={setDescription}
								placeholder="Describe the feature or feedback in detail..."
								placeholderTextColor={theme.colors.muted}
								editable={!isSubmitting}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									minHeight: 120,
									textAlignVertical: 'top',
									marginBottom: 16,
								}}
								multiline
							/>
							{error && (
								<View
									style={{
										backgroundColor: theme.colors.danger + '20',
										borderWidth: 1,
										borderColor: theme.colors.danger,
										borderRadius: 8,
										padding: 12,
										marginBottom: 16,
									}}
								>
									<Text
										style={{
											color: theme.colors.danger,
											fontSize: 13,
											fontWeight: '600',
											marginBottom: 4,
										}}
									>
										Submission failed
									</Text>
									<Text
										style={{
											color: theme.colors.danger,
											fontSize: 12,
										}}
									>
										{error}
									</Text>
								</View>
							)}
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
									marginBottom: 16,
								}}
							>
								The title is generated automatically from your description.
								Creates a GitHub issue via the remote server. Requires gh and
								claude CLIs installed and authenticated on the server (gh auth
								login).
							</Text>
							<Pressable
								onPress={handleSubmit}
								disabled={!canSubmit}
								style={{
									backgroundColor: canSubmit
										? theme.colors.primary
										: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									flexDirection: 'row',
									justifyContent: 'center',
								}}
							>
								{(isSubmitting || isResolvingTarget) && (
									<ActivityIndicator
										size="small"
										color={theme.colors.buttonTextOnPrimary}
										style={{ marginRight: 8 }}
									/>
								)}
								<Text
									style={{
										color: canSubmit
											? theme.colors.buttonTextOnPrimary
											: theme.colors.textSecondary,
										fontWeight: '700',
									}}
								>
									{isSubmitting
										? 'Submitting...'
										: isResolvingTarget
											? 'Resolving repository...'
											: 'Submit Feature Request'}
								</Text>
							</Pressable>
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
