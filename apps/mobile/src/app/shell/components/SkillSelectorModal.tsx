import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	ActivityIndicator,
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	useWindowDimensions,
	View,
} from 'react-native';
import {
	filterDiscoveredSkills,
	type DiscoveredSkill,
} from '@/lib/skill-discovery';
import { useTheme } from '@/lib/theme';

export function SkillSelectorModal({
	open,
	bottomOffset,
	skills,
	isLoading,
	error,
	onClose,
	onRetry,
	onSelect,
}: {
	open: boolean;
	bottomOffset: number;
	skills: readonly DiscoveredSkill[];
	isLoading: boolean;
	error: string | null;
	onClose: () => void;
	onRetry: () => void;
	onSelect: (skill: DiscoveredSkill) => void;
}) {
	const theme = useTheme();
	const { height: windowHeight } = useWindowDimensions();
	const [query, setQuery] = useState('');
	const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
	const androidBottomInset =
		Platform.OS === 'android' ? androidKeyboardHeight : 0;
	const dialogMaxHeight = useMemo(() => {
		const usableHeight = Math.max(
			0,
			windowHeight - bottomOffset - androidBottomInset,
		);
		const comfortableHeight = Math.floor(usableHeight * 0.85);
		return Math.min(usableHeight, Math.max(120, comfortableHeight));
	}, [androidBottomInset, bottomOffset, windowHeight]);

	useEffect(() => {
		if (!open) {
			// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset search text when parent closes the modal.
			setQuery('');
			if (Platform.OS === 'android') {
				// eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- Reset keyboard inset when parent closes the modal.
				setAndroidKeyboardHeight(0);
			}
		}
	}, [open]);

	useEffect(() => {
		if (Platform.OS !== 'android' || !open) return undefined;
		const showSubscription = Keyboard.addListener(
			'keyboardDidShow',
			(event) => {
				setAndroidKeyboardHeight(event.endCoordinates.height);
			},
		);
		const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
			setAndroidKeyboardHeight(0);
		});
		return () => {
			showSubscription.remove();
			hideSubscription.remove();
		};
	}, [open]);

	const filteredSkills = useMemo(
		() => filterDiscoveredSkills(skills, query),
		[query, skills],
	);

	const handleClose = useCallback(() => {
		setQuery('');
		onClose();
	}, [onClose]);

	const handleSelect = useCallback(
		(skill: DiscoveredSkill) => {
			setQuery('');
			onSelect(skill);
		},
		[onSelect],
	);

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
					style={{ flex: 1, justifyContent: 'flex-end' }}
				>
					<View
						onStartShouldSetResponder={() => true}
						style={{
							backgroundColor: theme.colors.background,
							borderTopLeftRadius: 16,
							padding: 16,
							borderColor: theme.colors.borderStrong,
							borderWidth: 1,
							maxHeight: dialogMaxHeight,
							width: '70%',
							maxWidth: 360,
							minWidth: 260,
							alignSelf: 'flex-end',
							marginRight: 8,
							marginBottom: bottomOffset + androidBottomInset,
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
								Skills
							</Text>
							<Pressable
								accessibilityRole="button"
								onPress={handleClose}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 10,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
							</Pressable>
						</View>

						<TextInput
							value={query}
							onChangeText={setQuery}
							placeholder="Filter skills"
							placeholderTextColor={theme.colors.muted}
							accessibilityLabel="Filter skills"
							autoCapitalize="none"
							autoCorrect={false}
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

						{error !== null ? (
							<View>
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
								<Pressable
									accessibilityRole="button"
									onPress={onRetry}
									style={{
										backgroundColor: theme.colors.primary,
										borderRadius: 10,
										paddingVertical: 12,
										alignItems: 'center',
									}}
								>
									<Text
										style={{
											color: theme.colors.buttonTextOnPrimary,
											fontWeight: '700',
										}}
									>
										Retry
									</Text>
								</Pressable>
							</View>
						) : isLoading ? (
							<View
								style={{
									flexDirection: 'row',
									alignItems: 'center',
									paddingVertical: 12,
								}}
							>
								<ActivityIndicator
									size="small"
									color={theme.colors.textPrimary}
									style={{ marginRight: 8 }}
								/>
								<Text style={{ color: theme.colors.textSecondary }}>
									Loading skills...
								</Text>
							</View>
						) : filteredSkills.length === 0 ? (
							<Text style={{ color: theme.colors.textSecondary }}>
								{skills.length === 0
									? 'No repo-local skills found.'
									: 'No matching skills.'}
							</Text>
						) : (
							<ScrollView keyboardShouldPersistTaps="handled">
								{filteredSkills.map((skill) => (
									<Pressable
										key={skill.path}
										accessibilityRole="button"
										onPress={() => handleSelect(skill)}
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
											{`$${skill.name}`}
										</Text>
										{skill.description ? (
											<Text
												numberOfLines={2}
												style={{
													color: theme.colors.textSecondary,
													fontSize: 12,
													marginTop: 2,
												}}
											>
												{skill.description}
											</Text>
										) : null}
									</Pressable>
								))}
							</ScrollView>
						)}
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
