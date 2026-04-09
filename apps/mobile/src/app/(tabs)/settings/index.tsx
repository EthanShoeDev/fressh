import { Link } from 'expo-router';
import * as Updates from 'expo-updates';
import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { buildSettingsSecurityLinks } from '@/lib/settings-security-links';
import { preferences } from '@/lib/preferences';
import { useTheme, useThemeControls } from '@/lib/theme';

export default function Tab() {
	const jsVersion = '2026.02.09.1';
	const theme = useTheme();
	const { themeName, setThemeName } = useThemeControls();
	const [lastUpdateCheck, setLastUpdateCheck] =
		preferences.updates.lastCheckAt.useLastCheckAt();
	const [updateStatus, setUpdateStatus] = React.useState<string | null>(null);
	const [updateError, setUpdateError] = React.useState<string | null>(null);
	const [updateBusy, setUpdateBusy] = React.useState(false);

	const handleCheckForUpdates = React.useCallback(async () => {
		if (!Updates.isEnabled) {
			Alert.alert(
				'Updates disabled',
				'Over-the-air updates are disabled in this build. Install a preview or production build from EAS to use updates.',
			);
			return;
		}
		const now = new Date().toISOString();
		setLastUpdateCheck(now);
		setUpdateError(null);
		setUpdateStatus('Checking for updates…');
		setUpdateBusy(true);
		try {
			const update = await Updates.checkForUpdateAsync();
			if (!update.isAvailable) {
				setUpdateStatus('You are up to date.');
				return;
			}
			setUpdateStatus('Downloading update…');
			await Updates.fetchUpdateAsync();
			setUpdateStatus('Update ready. Restart to apply.');
			Alert.alert(
				'Update ready',
				'Restart the app now to apply the update?',
				[
					{ text: 'Later', style: 'cancel' },
					{ text: 'Restart', onPress: () => void Updates.reloadAsync() },
				],
			);
		} catch (error) {
			setUpdateStatus(null);
			setUpdateError(
				error instanceof Error ? error.message : 'Update check failed.',
			);
		} finally {
			setUpdateBusy(false);
		}
	}, [setLastUpdateCheck]);

	const handleResetUpdateStatus = React.useCallback(() => {
		Alert.alert(
			'Reset update status?',
			'This clears the last check time and local update status messages. It does not remove the installed update bundle.',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Reset',
					style: 'destructive',
					onPress: () => {
						setUpdateStatus(null);
						setUpdateError(null);
						setLastUpdateCheck(null);
						void Updates.clearLogEntriesAsync().catch(() => {});
					},
				},
			],
		);
	}, [setLastUpdateCheck]);

	const formatTimestamp = React.useCallback((value: string | Date | null) => {
		if (!value) return '—';
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleString();
	}, []);

	const updateInfo = React.useMemo(
		() => ({
			jsVersion,
			channel: Updates.channel ?? '—',
			updateId: Updates.updateId ?? 'Bundled',
			runtimeVersion: Updates.runtimeVersion ?? '—',
			createdAt: Updates.createdAt
				? formatTimestamp(Updates.createdAt)
				: 'Bundled',
			lastCheckAt: lastUpdateCheck ? formatTimestamp(lastUpdateCheck) : 'Never',
		}),
		[formatTimestamp, jsVersion, lastUpdateCheck],
	);

	return (
		<View
			style={{ flex: 1, padding: 16, backgroundColor: theme.colors.background }}
		>
			<View style={{ marginBottom: 24 }}>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 14,
						marginBottom: 8,
					}}
				>
					Theme
				</Text>
				<View style={{ gap: 8 }}>
					<Row
						label="Dark"
						selected={themeName === 'dark'}
						onPress={() => {
							setThemeName('dark');
						}}
					/>
					<Row
						label="Light"
						selected={themeName === 'light'}
						onPress={() => {
							setThemeName('light');
						}}
					/>
				</View>
			</View>

			<View style={{ marginBottom: 24 }}>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 14,
						marginBottom: 8,
					}}
				>
					Security
				</Text>
				{buildSettingsSecurityLinks().map((entry, index) => (
					<Link key={entry.href} href={entry.href} asChild>
						<Pressable
							style={{
								marginTop: index === 0 ? 0 : 12,
								backgroundColor: theme.colors.surface,
								borderWidth: 1,
								borderColor: theme.colors.border,
								borderRadius: 12,
								paddingHorizontal: 12,
								paddingVertical: 14,
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
							}}
							accessibilityRole="button"
						>
							<Text
								style={{
									color: theme.colors.textPrimary,
									fontSize: 16,
									fontWeight: '600',
								}}
							>
								{entry.label}
							</Text>
							<Text
								style={{
									color: theme.colors.muted,
									fontSize: 22,
									paddingHorizontal: 4,
								}}
							>
								›
							</Text>
						</Pressable>
					</Link>
				))}
			</View>
			<View style={{ marginBottom: 24 }}>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 14,
						marginBottom: 8,
					}}
				>
					Updates
				</Text>
				<Pressable
					style={{
						backgroundColor: theme.colors.surface,
						borderWidth: 1,
						borderColor: theme.colors.border,
						borderRadius: 12,
						paddingHorizontal: 12,
						paddingVertical: 14,
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'space-between',
						opacity: updateBusy ? 0.7 : 1,
					}}
					accessibilityRole="button"
					onPress={() => void handleCheckForUpdates()}
					disabled={updateBusy}
				>
					<View style={{ flex: 1, marginRight: 12 }}>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 16,
								fontWeight: '600',
								marginBottom: updateStatus || updateError ? 4 : 0,
							}}
						>
							Check for Updates
						</Text>
						{updateStatus ? (
							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 12,
								}}
							>
								{updateStatus}
							</Text>
						) : null}
						{updateError ? (
							<Text
								style={{
									color: theme.colors.danger,
									fontSize: 12,
								}}
							>
								{updateError}
							</Text>
						) : null}
					</View>
					<Text
						style={{
							color: theme.colors.muted,
							fontSize: 14,
							fontWeight: '600',
						}}
					>
						{updateBusy ? '…' : 'Check'}
					</Text>
				</Pressable>
				<Pressable
					style={{
						marginTop: 10,
						borderWidth: 1,
						borderColor: theme.colors.border,
						borderRadius: 12,
						paddingHorizontal: 12,
						paddingVertical: 12,
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'space-between',
					}}
					accessibilityRole="button"
					onPress={handleResetUpdateStatus}
				>
					<Text
						style={{
							color: theme.colors.textSecondary,
							fontSize: 14,
							fontWeight: '600',
						}}
					>
						Reset Update Status
					</Text>
					<Text
						style={{
							color: theme.colors.muted,
							fontSize: 14,
							fontWeight: '600',
						}}
					>
						Clear
					</Text>
				</Pressable>
				<View style={{ marginTop: 10, gap: 6 }}>
					<InfoRow label="JS Version" value={updateInfo.jsVersion} />
					<InfoRow label="Channel" value={updateInfo.channel} />
					<InfoRow label="Update ID" value={updateInfo.updateId} />
					<InfoRow label="Runtime" value={updateInfo.runtimeVersion} />
					<InfoRow label="Update time" value={updateInfo.createdAt} />
					<InfoRow label="Last check" value={updateInfo.lastCheckAt} />
				</View>
			</View>
		</View>
	);
}

function Row({
	label,
	selected,
	onPress,
}: {
	label: string;
	selected?: boolean;
	onPress: () => void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			onPress={onPress}
			style={[
				{
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'space-between',
					backgroundColor: theme.colors.surface,
					borderWidth: 1,
					borderColor: theme.colors.border,
					borderRadius: 10,
					paddingHorizontal: 12,
					paddingVertical: 12,
				},
				selected ? { borderColor: theme.colors.primary } : undefined,
			]}
			accessibilityRole="button"
			accessibilityState={{ selected }}
		>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 16,
					fontWeight: '600',
				}}
			>
				{label}
			</Text>
			<Text
				style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '800' }}
			>
				{selected ? '✔' : ''}
			</Text>
		</Pressable>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	const theme = useTheme();
	return (
		<View
			style={{
				flexDirection: 'row',
				justifyContent: 'space-between',
				alignItems: 'center',
				gap: 12,
			}}
		>
			<Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
				{label}
			</Text>
			<Text
				style={{
					color: theme.colors.textPrimary,
					fontSize: 12,
					fontWeight: '600',
					textAlign: 'right',
					flexShrink: 1,
				}}
			>
				{value}
			</Text>
		</View>
	);
}
