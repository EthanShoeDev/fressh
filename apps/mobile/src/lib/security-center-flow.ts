import { type StoredConnectionEntry } from './connection-storage';
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

export async function restoreBackupPayload(params: {
	payload: BackupPayload;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
}) {
	return replaceAllFromBackup({
		payload: params.payload,
		replaceAllKeys: params.replaceAllKeys,
		replaceAllConnections: params.replaceAllConnections,
	});
}
