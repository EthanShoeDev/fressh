import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyList } from '@/components/key-manager/KeyList';
import {
	createBackupPayload,
	type BackupPayload,
} from '@/lib/device-migration';
import { secretsManager } from '@/lib/secrets-manager';
import {
	exportBackupForSharing,
	loadBackupPayloadFromPicker,
	restoreBackupPayload,
} from '@/lib/security-center-flow';
import { useTheme } from '@/lib/theme';

export function SecurityCenterScreen() {
	const theme = useTheme();
	const [isExporting, setIsExporting] = React.useState(false);
	const [isRestoring, setIsRestoring] = React.useState(false);
	const actionsDisabled = isExporting || isRestoring;

	const handleConfirmedRestore = React.useCallback(
		async (payload: BackupPayload) => {
			try {
				const result = await restoreBackupPayload({
					payload,
					replaceAllKeys: secretsManager.keys.utils.replaceAllEntries,
					replaceAllConnections:
						secretsManager.connections.utils.replaceAllEntries,
				});
				Alert.alert(
					'Restore complete',
					`Replaced ${result.restoredKeys} keys and ${result.restoredConnections} saved connections on this device.`,
				);
			} catch (error) {
				Alert.alert(
					'Restore failed',
					error instanceof Error
						? error.message
						: 'Failed to restore from backup file.',
				);
			} finally {
				setIsRestoring(false);
			}
		},
		[],
	);

	const handleExport = React.useCallback(async () => {
		if (actionsDisabled) return;

		setIsExporting(true);
		try {
			await exportBackupForSharing({
				createBackupPayload: () =>
					createBackupPayload({
						listKeys: secretsManager.keys.utils.listEntriesWithValues,
						listConnections:
							secretsManager.connections.utils.listEntriesWithValues,
					}),
				cacheDirectory: FileSystem.cacheDirectory,
				writeAsString: (path, value) =>
					FileSystem.writeAsStringAsync(path, value, {
						encoding: FileSystem.EncodingType.UTF8,
					}),
				isSharingAvailable: Sharing.isAvailableAsync,
				share: Sharing.shareAsync,
				deleteFile: (path) =>
					FileSystem.deleteAsync(path, { idempotent: true }),
			});
			Alert.alert(
				'Backup shared',
				'Backup file was prepared and opened in the system share sheet.',
			);
		} catch (error) {
			Alert.alert(
				'Backup failed',
				error instanceof Error
					? error.message
					: 'Failed to create backup file.',
			);
		} finally {
			setIsExporting(false);
		}
	}, [actionsDisabled]);

	const handleRestore = React.useCallback(async () => {
		if (actionsDisabled) return;

		setIsRestoring(true);
		try {
			const result = await loadBackupPayloadFromPicker({
				pickDocument: () =>
					DocumentPicker.getDocumentAsync({
						multiple: false,
						copyToCacheDirectory: true,
						type: ['application/json', 'text/*'],
					}),
				readAsString: (uri) =>
					FileSystem.readAsStringAsync(uri, {
						encoding: FileSystem.EncodingType.UTF8,
					}),
			});
			if (result.status === 'cancelled') {
				setIsRestoring(false);
				return;
			}

			Alert.alert(
				'Replace this device?',
				`This will replace ${result.payload.keys.length} keys and ${result.payload.connections.length} saved connections on this device.`,
				[
					{
						text: 'Cancel',
						style: 'cancel',
						onPress: () => {
							setIsRestoring(false);
						},
					},
					{
						text: 'Replace',
						style: 'destructive',
						onPress: () => {
							void handleConfirmedRestore(result.payload);
						},
					},
				],
				{
					cancelable: true,
					onDismiss: () => {
						setIsRestoring(false);
					},
				},
			);
		} catch (error) {
			Alert.alert(
				'Restore failed',
				error instanceof Error ? error.message : 'Failed to load backup file.',
			);
			setIsRestoring(false);
		}
	}, [actionsDisabled, handleConfirmedRestore]);

	return (
		<ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
			<View>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 20,
						fontWeight: '700',
						marginBottom: 8,
					}}
				>
					Keys
				</Text>
				<KeyList mode="manage" />
			</View>
			<View
				style={{
					backgroundColor: theme.colors.surface,
					borderWidth: 1,
					borderColor: theme.colors.border,
					borderRadius: 12,
					padding: 16,
					gap: 12,
				}}
			>
				<Text
					style={{
						color: theme.colors.textPrimary,
						fontSize: 20,
						fontWeight: '700',
					}}
				>
					Move to New Device
				</Text>
				<Text style={{ color: theme.colors.textSecondary }}>
					Back up your private keys and saved hosts, or replace this device with
					a backup file.
				</Text>
				<Pressable
					onPress={() => void handleExport()}
					disabled={actionsDisabled}
					style={actionsDisabled ? { opacity: 0.6 } : undefined}
				>
					<Text style={{ color: theme.colors.textPrimary }}>
						{isExporting ? 'Creating Backup File…' : 'Create Backup File'}
					</Text>
				</Pressable>
				<Pressable
					onPress={() => void handleRestore()}
					disabled={actionsDisabled}
					style={actionsDisabled ? { opacity: 0.6 } : undefined}
				>
					<Text style={{ color: theme.colors.textPrimary }}>
						{isRestoring ? 'Restoring…' : 'Restore From Backup File'}
					</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}
