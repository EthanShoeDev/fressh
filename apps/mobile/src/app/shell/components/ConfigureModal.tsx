import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

interface ConfigOption {
	label: string;
	description?: string;
	onPress: () => void;
}

export function ConfigureModal({
	open,
	bottomOffset,
	onClose,
	onDevServer,
	onReloadConfig,
	onHostConfig,
	onRequestFeature,
	onOpenGitHubIssues,
	onOpenShellConfigDocs,
	configVersion,
	configUpdatedAt,
	configSource,
	configLastLoadedAt,
	configLastError,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onDevServer: () => void;
	onReloadConfig: () => void;
	onHostConfig: () => void;
	onRequestFeature: () => void;
	onOpenGitHubIssues: () => void;
	onOpenShellConfigDocs: () => void;
	configVersion: string;
	configUpdatedAt: string;
	configSource: string;
	configLastLoadedAt: string | null;
	configLastError: string | null;
}) {
	const theme = useTheme();

	const options: ConfigOption[] = [
		{
			label: 'Dev server',
			description: 'Handle dev server',
			onPress: onDevServer,
		},
		{
			label: 'Reload config',
			description: 'Fetch the latest keyboard and command menu config',
			onPress: onReloadConfig,
		},
		{
			label: 'Host config',
			description: 'Edit connection settings',
			onPress: onHostConfig,
		},
		{
			label: 'GitHub issues',
			description: 'Open project issues page',
			onPress: onOpenGitHubIssues,
		},
		{
			label: 'Request a Feature',
			description: 'Submit feedback or feature request',
			onPress: onRequestFeature,
		},
	];

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
							Configure
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
					<View
						style={{
							padding: 12,
							borderRadius: 10,
							borderWidth: 1,
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.surface,
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 14,
								fontWeight: '600',
							}}
						>
							{`Config ${configVersion}`}
						</Text>
						<Text
							style={{
								color: theme.colors.textSecondary,
								fontSize: 12,
								marginTop: 2,
							}}
						>
							{`Source: ${configSource}`}
						</Text>
						<Text
							style={{
								color: theme.colors.textSecondary,
								fontSize: 12,
								marginTop: 2,
							}}
						>
							{`Updated: ${configUpdatedAt}`}
						</Text>
						{configLastLoadedAt ? (
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
									marginTop: 2,
								}}
							>
								{`Loaded: ${configLastLoadedAt}`}
							</Text>
						) : null}
					</View>
					{options.map((option, index) => (
						<Pressable
							key={option.label}
							onPress={option.onPress}
							style={{
								paddingVertical: 12,
								paddingHorizontal: 12,
								borderRadius: 10,
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.surface,
								marginBottom: index < options.length - 1 ? 8 : 0,
							}}
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 14,
									fontWeight: '600',
								}}
							>
								{option.label}
							</Text>
							{option.description && (
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontSize: 12,
										marginTop: 2,
									}}
								>
									{option.description}
								</Text>
							)}
						</Pressable>
					))}
					{configLastError ? (
						<View
							style={{
								padding: 12,
								borderRadius: 10,
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.surface,
								marginTop: 8,
							}}
						>
							<Text
								numberOfLines={8}
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
								}}
							>
								{`Last error: ${configLastError}`}
							</Text>
						</View>
					) : null}
					<Pressable
						onPress={onOpenShellConfigDocs}
						style={{ marginTop: 10, alignSelf: 'flex-start' }}
					>
						<Text
							style={{
								color: theme.colors.primary,
								fontSize: 12,
								fontWeight: '600',
							}}
						>
							Shell config docs
						</Text>
					</Pressable>
				</View>
			</Pressable>
		</Modal>
	);
}
