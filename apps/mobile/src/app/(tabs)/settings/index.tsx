import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Link } from 'expo-router';
import * as Updates from 'expo-updates';
import React from 'react';
import {
	Alert,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { preferences } from '@/lib/preferences';
import { secretsManager } from '@/lib/secrets-manager';
import { useTheme, useThemeControls } from '@/lib/theme';

export default function Tab() {
	const jsVersion = '2026.02.09.1';
	const theme = useTheme();
	const { themeName, setThemeName } = useThemeControls();
	const [lastUpdateCheck, setLastUpdateCheck] =
		preferences.updates.lastCheckAt.useLastCheckAt();
	const [backupOpen, setBackupOpen] = React.useState(false);
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
				<Link href="/(tabs)/settings/key-manager" asChild>
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
							Manage Keys
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
				<Pressable
					style={{
						marginTop: 12,
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
					onPress={() => setBackupOpen(true)}
				>
					<Text
						style={{
							color: theme.colors.textPrimary,
							fontSize: 16,
							fontWeight: '600',
						}}
					>
						Backup & Restore
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
			<BackupRestoreModal
				open={backupOpen}
				onClose={() => setBackupOpen(false)}
			/>
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

function BackupRestoreModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const theme = useTheme();
	const [backupText, setBackupText] = React.useState('');
	const [restoreText, setRestoreText] = React.useState('');
	const [backupError, setBackupError] = React.useState<string | null>(null);
	const [restoreError, setRestoreError] = React.useState<string | null>(null);
	const [isExporting, setIsExporting] = React.useState(false);
	const [isRestoring, setIsRestoring] = React.useState(false);
	const [copied, setCopied] = React.useState(false);

	const handleClose = React.useCallback(() => {
		onClose();
	}, [onClose]);

	const handleGenerateBackup = React.useCallback(async () => {
		setBackupError(null);
		setCopied(false);
		setIsExporting(true);
		try {
			const [keys, connections] = await Promise.all([
				secretsManager.keys.utils.listEntriesWithValues(),
				secretsManager.connections.utils.listEntriesWithValues(),
			]);
			const payload = {
				version: 1,
				createdAt: new Date().toISOString(),
				keys: keys.map((entry) => ({
					id: entry.id,
					metadata: entry.metadata,
					value: entry.value,
				})),
				connections: connections.map((entry) => ({
					id: entry.id,
					metadata: entry.metadata,
					value: entry.value,
				})),
			};
			setBackupText(JSON.stringify(payload, null, 2));
		} catch (error) {
			setBackupError(
				error instanceof Error ? error.message : 'Failed to create backup.',
			);
		} finally {
			setIsExporting(false);
		}
	}, []);

	const handleCopyBackup = React.useCallback(async () => {
		if (!backupText) return;
		await Clipboard.setStringAsync(backupText);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [backupText]);

	const restorePayload = React.useCallback(async (payload: string) => {
		const parsed = JSON.parse(payload);
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Invalid backup format.');
		}
		if (parsed.version !== 1) {
			throw new Error('Unsupported backup version.');
		}
		const keys = Array.isArray(parsed.keys) ? parsed.keys : [];
		const connections = Array.isArray(parsed.connections)
			? parsed.connections
			: [];

		// Restore keys first so connection key references remain valid.
		let restoredKeys = 0;
		for (const key of keys) {
			if (!key?.id || !key?.value) continue;
			await secretsManager.keys.utils.upsertPrivateKey({
				keyId: key.id,
				value: key.value,
				metadata: {
					priority: key.metadata?.priority ?? 0,
					label: key.metadata?.label,
					isDefault: key.metadata?.isDefault ?? false,
				},
			});
			restoredKeys += 1;
		}

		let restoredConnections = 0;
		for (const entry of connections) {
			if (!entry?.value) continue;
			await secretsManager.connections.utils.upsertConnection({
				details: entry.value,
				priority: entry.metadata?.priority ?? 0,
				label: entry.metadata?.label,
			});
			restoredConnections += 1;
		}

		Alert.alert(
			'Restore complete',
			`Restored ${restoredKeys} keys and ${restoredConnections} connections.`,
		);
	}, []);

	const doRestore = React.useCallback(
		async (payload: string) => {
			setRestoreError(null);
			setIsRestoring(true);
			try {
				await restorePayload(payload);
			} catch (error) {
				setRestoreError(
					error instanceof Error ? error.message : 'Restore failed.',
				);
			} finally {
				setIsRestoring(false);
			}
		},
		[restorePayload],
	);

	const handleRestore = React.useCallback(() => {
		if (!restoreText.trim()) return;
		Alert.alert(
			'Restore backup?',
			'This will merge the backup into your existing data. Matching key IDs will be overwritten.',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Restore',
					style: 'destructive',
					onPress: () => {
						void doRestore(restoreText);
					},
				},
			],
		);
	}, [doRestore, restoreText]);

	const handlePasteRestore = React.useCallback(async () => {
		const text = await Clipboard.getStringAsync();
		setRestoreText(text);
	}, []);

	const handleImportFromFile = React.useCallback(async () => {
		setRestoreError(null);
		try {
			const baseDir = FileSystem.documentDirectory;
			if (!baseDir) {
				throw new Error('Local storage is unavailable.');
			}
			const path = `${baseDir}backup.json`;
			const info = await FileSystem.getInfoAsync(path);
			if (!info.exists) {
				throw new Error('No backup found at files/backup.json.');
			}
			const text = await FileSystem.readAsStringAsync(path, {
				encoding: FileSystem.EncodingType.UTF8,
			});
			setRestoreText(text);
			Alert.alert(
				'Restore backup from file?',
				'This will merge the backup into your existing data. Matching key IDs will be overwritten.',
				[
					{ text: 'Cancel', style: 'cancel' },
					{
						text: 'Restore',
						style: 'destructive',
						onPress: () => {
							void doRestore(text);
						},
					},
				],
			);
		} catch (error) {
			setRestoreError(
				error instanceof Error ? error.message : 'Import failed.',
			);
		}
	}, [doRestore]);

	const handleImportFromPicker = React.useCallback(async () => {
		setRestoreError(null);
		try {
			const res = await DocumentPicker.getDocumentAsync({
				multiple: false,
				copyToCacheDirectory: true,
				type: ['application/json', 'text/*', 'application/*'],
			});
			const canceled = 'canceled' in res ? res.canceled : false;
			if (canceled) return;
			const asset = res.assets?.[0];
			if (!asset?.uri) {
				throw new Error('No file selected.');
			}
			const text = await FileSystem.readAsStringAsync(asset.uri, {
				encoding: FileSystem.EncodingType.UTF8,
			});
			setRestoreText(text);
			Alert.alert(
				'Restore backup from selected file?',
				'This will merge the backup into your existing data. Matching key IDs will be overwritten.',
				[
					{ text: 'Cancel', style: 'cancel' },
					{
						text: 'Restore',
						style: 'destructive',
						onPress: () => {
							void doRestore(text);
						},
					},
				],
			);
		} catch (error) {
			setRestoreError(
				error instanceof Error ? error.message : 'Import failed.',
			);
		}
	}, [doRestore]);

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={handleClose}
		>
			<Pressable
				onPress={handleClose}
				style={{ flex: 1, backgroundColor: theme.colors.overlay }}
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
								Backup & Restore
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
						<ScrollView
							contentContainerStyle={{ paddingBottom: 16 }}
							keyboardShouldPersistTaps="handled"
						>
							<Text style={{ color: theme.colors.textSecondary, marginBottom: 12 }}>
								Backups include private keys and connection profiles. Store them
								somewhere safe.
							</Text>

							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Backup
							</Text>
							<Pressable
								onPress={handleGenerateBackup}
								disabled={isExporting}
								style={{
									backgroundColor: theme.colors.primary,
									borderRadius: 10,
									paddingVertical: 12,
									alignItems: 'center',
									opacity: isExporting ? 0.6 : 1,
									marginBottom: 10,
								}}
							>
								<Text
									style={{
										color: theme.colors.buttonTextOnPrimary,
										fontWeight: '700',
									}}
								>
									{isExporting ? 'Generating…' : 'Generate Backup'}
								</Text>
							</Pressable>
							{backupText ? (
								<>
									<TextInput
										editable={false}
										multiline
										value={backupText}
										style={{
											borderWidth: 1,
											borderColor: theme.colors.border,
											backgroundColor: theme.colors.inputBackground,
											color: theme.colors.textSecondary,
											borderRadius: 10,
											paddingHorizontal: 12,
											paddingVertical: 10,
											minHeight: 140,
											marginBottom: 8,
											fontSize: 11,
										}}
									/>
									<Pressable
										onPress={handleCopyBackup}
										style={{
											borderWidth: 1,
											borderColor: theme.colors.border,
											borderRadius: 10,
											paddingVertical: 10,
											alignItems: 'center',
											marginBottom: 16,
										}}
									>
										<Text
											style={{
												color: theme.colors.textSecondary,
												fontWeight: '600',
											}}
										>
											{copied ? 'Copied!' : 'Copy Backup'}
										</Text>
									</Pressable>
								</>
							) : null}
							{backupError ? (
								<Text style={{ color: theme.colors.danger, marginBottom: 16 }}>
									{backupError}
								</Text>
							) : null}

							<Text
								style={{
									color: theme.colors.textSecondary,
									fontSize: 14,
									fontWeight: '600',
									marginBottom: 6,
								}}
							>
								Restore
							</Text>
							<TextInput
								multiline
								value={restoreText}
								onChangeText={setRestoreText}
								placeholder="Paste backup JSON here"
								placeholderTextColor={theme.colors.muted}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: theme.colors.inputBackground,
									color: theme.colors.textPrimary,
									borderRadius: 10,
									paddingHorizontal: 12,
									paddingVertical: 10,
									minHeight: 140,
									marginBottom: 8,
									fontSize: 11,
								}}
							/>
							<View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
								<Pressable
									onPress={handlePasteRestore}
									style={{
										flex: 1,
										borderWidth: 1,
										borderColor: theme.colors.border,
										borderRadius: 10,
										paddingVertical: 10,
										alignItems: 'center',
									}}
								>
									<Text
										style={{
											color: theme.colors.textSecondary,
											fontWeight: '600',
										}}
									>
										Paste
									</Text>
								</Pressable>
								<Pressable
									onPress={handleRestore}
									disabled={isRestoring}
									style={{
										flex: 1,
										backgroundColor: theme.colors.primary,
										borderRadius: 10,
										paddingVertical: 10,
										alignItems: 'center',
										opacity: isRestoring ? 0.6 : 1,
									}}
								>
									<Text
										style={{
											color: theme.colors.buttonTextOnPrimary,
											fontWeight: '700',
										}}
									>
										{isRestoring ? 'Restoring…' : 'Restore'}
									</Text>
								</Pressable>
							</View>
							<Pressable
								onPress={handleImportFromFile}
								disabled={isRestoring}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 10,
									alignItems: 'center',
									marginBottom: 12,
									opacity: isRestoring ? 0.6 : 1,
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
									Import from files/backup.json
								</Text>
							</Pressable>
							<Pressable
								onPress={handleImportFromPicker}
								disabled={isRestoring}
								style={{
									borderWidth: 1,
									borderColor: theme.colors.border,
									borderRadius: 10,
									paddingVertical: 10,
									alignItems: 'center',
									marginBottom: 12,
									opacity: isRestoring ? 0.6 : 1,
								}}
							>
								<Text
									style={{
										color: theme.colors.textSecondary,
										fontWeight: '600',
									}}
								>
									Import from picked file
								</Text>
							</Pressable>
							{restoreError ? (
								<Text style={{ color: theme.colors.danger, marginBottom: 8 }}>
									{restoreError}
								</Text>
							) : null}
						</ScrollView>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
