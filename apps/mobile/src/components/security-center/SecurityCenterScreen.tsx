import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyList } from '@/components/key-manager/KeyList';
import {
	createBackupPayload,
	parseBackupPayload,
	replaceAllFromBackup,
} from '@/lib/device-migration';
import { secretsManager } from '@/lib/secrets-manager';
import { useTheme } from '@/lib/theme';

export function SecurityCenterScreen() {
	const theme = useTheme();

	const handleExport = React.useCallback(async () => {
		const payload = await createBackupPayload({
			listKeys: secretsManager.keys.utils.listEntriesWithValues,
			listConnections: secretsManager.connections.utils.listEntriesWithValues,
		});
		const backupPath = `${FileSystem.cacheDirectory}fressh-backup.json`;
		await FileSystem.writeAsStringAsync(
			backupPath,
			JSON.stringify(payload, null, 2),
			{ encoding: FileSystem.EncodingType.UTF8 },
		);
		await Sharing.shareAsync(backupPath, {
			mimeType: 'application/json',
			dialogTitle: 'Share Backup File',
		});
	}, []);

	const handleRestore = React.useCallback(async () => {
		const picked = await DocumentPicker.getDocumentAsync({
			multiple: false,
			copyToCacheDirectory: true,
			type: ['application/json', 'text/*'],
		});
		if ('canceled' in picked && picked.canceled) return;
		const asset = picked.assets?.[0];
		if (!asset?.uri) throw new Error('No backup file selected.');
		const raw = await FileSystem.readAsStringAsync(asset.uri, {
			encoding: FileSystem.EncodingType.UTF8,
		});
		const payload = parseBackupPayload(raw);
		Alert.alert(
			'Replace this device?',
			`This will replace ${payload.keys.length} keys and ${payload.connections.length} saved connections on this device.`,
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Replace',
					style: 'destructive',
					onPress: () => {
						void replaceAllFromBackup({
							payload,
							replaceAllKeys: secretsManager.keys.utils.replaceAllEntries,
							replaceAllConnections:
								secretsManager.connections.utils.replaceAllEntries,
						});
					},
				},
			],
		);
	}, []);

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
					Back up your private keys and saved hosts, or replace this device
					with a backup file.
				</Text>
				<Pressable onPress={() => void handleExport()}>
					<Text style={{ color: theme.colors.textPrimary }}>
						Create Backup File
					</Text>
				</Pressable>
				<Pressable onPress={() => void handleRestore()}>
					<Text style={{ color: theme.colors.textPrimary }}>
						Restore From Backup File
					</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}
