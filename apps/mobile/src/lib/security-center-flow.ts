import { type StoredConnectionEntry } from './connection-storage';
import { formatSavedConnectionSummary } from './connection-utils';
import {
	parseBackupPayload,
	replaceAllFromBackup,
	type BackupPayload,
	type BackupKeyEntry,
} from './device-migration';

type SecurityCenterShareOptions = {
	mimeType: string;
	dialogTitle: string;
};

type SecurityCenterPickerAsset = {
	uri?: string | null;
};

export type SecurityCenterPickerResult =
	| {
			canceled: true;
			assets?: SecurityCenterPickerAsset[] | null;
	  }
	| {
			canceled?: false;
			assets?: SecurityCenterPickerAsset[] | null;
	  };

export async function exportBackupForSharing(params: {
	createBackupPayload: () => Promise<BackupPayload>;
	cacheDirectory: string | null | undefined;
	writeAsString: (path: string, value: string) => Promise<void>;
	isSharingAvailable: () => Promise<boolean>;
	share: (path: string, options: SecurityCenterShareOptions) => Promise<void>;
	deleteFile?: (path: string) => Promise<void>;
}) {
	if (!params.cacheDirectory) {
		throw new Error('Temporary backup storage is unavailable.');
	}

	const payload = await params.createBackupPayload();
	const backupPath = `${params.cacheDirectory}fressh-backup.json`;

	await params.writeAsString(backupPath, JSON.stringify(payload, null, 2));

	try {
		const isSharingAvailable = await params.isSharingAvailable();
		if (!isSharingAvailable) {
			throw new Error('Sharing is unavailable on this device.');
		}
		await params.share(backupPath, {
			mimeType: 'application/json',
			dialogTitle: 'Share Backup File',
		});
		return { backupPath };
	} finally {
		if (params.deleteFile) {
			await params.deleteFile(backupPath).catch(() => {});
		}
	}
}

export async function loadBackupPayloadFromPicker(params: {
	pickDocument: () => Promise<SecurityCenterPickerResult>;
	readAsString: (uri: string) => Promise<string>;
}) {
	const picked = await params.pickDocument();
	if ('canceled' in picked && picked.canceled) {
		return { status: 'cancelled' as const };
	}

	const asset = picked.assets?.[0];
	if (!asset?.uri) {
		throw new Error('No backup file selected.');
	}

	const raw = await params.readAsString(asset.uri);
	return {
		status: 'selected' as const,
		payload: parseBackupPayload(raw),
	};
}

export function createRestorePreflightSummary(payload: BackupPayload) {
	const keys = payload.keys.map((entry) => ({
		id: entry.id,
		label: entry.metadata.label ?? entry.id,
	}));
	const connections = payload.connections.map((entry) => ({
		id: entry.id,
		label: formatSavedConnectionSummary(entry),
	}));
	const keyLines =
		keys.length > 0
			? keys.map((entry) => `- ${entry.label}`).join('\n')
			: '- None';
	const connectionLines =
		connections.length > 0
			? connections.map((entry) => `- ${entry.label}`).join('\n')
			: '- None';

	return {
		keys,
		connections,
		message: `Keys to replace:\n${keyLines}\n\nSaved connections to replace:\n${connectionLines}`,
	};
}

export async function restoreBackupPayload(params: {
	payload: BackupPayload;
	listCurrentKeys: () => Promise<BackupKeyEntry[]>;
	listCurrentConnections: () => Promise<StoredConnectionEntry[]>;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
}) {
	const previousKeys = await params.listCurrentKeys();
	const previousConnections = await params.listCurrentConnections();

	try {
		return await replaceAllFromBackup({
			payload: params.payload,
			replaceAllKeys: params.replaceAllKeys,
			replaceAllConnections: params.replaceAllConnections,
		});
	} catch (error) {
		try {
			await params.replaceAllKeys(previousKeys);
			await params.replaceAllConnections(previousConnections);
		} catch (rollbackError) {
			try {
				const reapplied = await replaceAllFromBackup({
					payload: params.payload,
					replaceAllKeys: params.replaceAllKeys,
					replaceAllConnections: params.replaceAllConnections,
				});
				return {
					...reapplied,
					recoveredConsistency: true as const,
				};
			} catch (recoveryError) {
				throw new Error(
					`Restore failed, rollback failed, and recovery failed: ${
						recoveryError instanceof Error
							? recoveryError.message
							: 'Unknown recovery error.'
					}`,
					{
						cause: new Error(
							`Rollback failed: ${
								rollbackError instanceof Error
									? rollbackError.message
									: 'Unknown rollback error.'
							}`,
							{ cause: error },
						),
					},
				);
			}
		}
		throw error;
	}
}
