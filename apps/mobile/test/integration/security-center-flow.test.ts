import assert from 'node:assert/strict';
import test from 'node:test';
import { type BackupPayload } from '../../src/lib/device-migration';
import {
	exportBackupForSharing,
	loadBackupPayloadFromPicker,
	restoreBackupPayload,
} from '../../src/lib/security-center-flow';

const backupPayload: BackupPayload = {
	version: 1 as const,
	createdAt: '2026-04-09T00:00:00.000Z',
	keys: [
		{
			id: 'key_1',
			metadata: {
				priority: 0,
				createdAtMs: 1,
				label: 'Primary key',
				isDefault: true,
			},
			value: 'PRIVATE KEY',
		},
	],
	connections: [
		{
			id: 'muly-dev-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 2,
				modifiedAtMs: 3,
				label: 'Dev Box',
			},
			value: {
				host: 'dev-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_1',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	],
};

void test('exportBackupForSharing writes the payload, shares it, and cleans up', async () => {
	const writes: { path: string; value: string }[] = [];
	const shares: string[] = [];
	const deleted: string[] = [];

	await exportBackupForSharing({
		createBackupPayload: async () => backupPayload,
		cacheDirectory: 'file:///cache/',
		writeAsString: async (path, value) => {
			writes.push({ path, value });
		},
		isSharingAvailable: async () => true,
		share: async (path) => {
			shares.push(path);
		},
		deleteFile: async (path) => {
			deleted.push(path);
		},
	});

	assert.equal(writes.length, 1);
	assert.equal(writes[0]?.path, 'file:///cache/fressh-backup.json');
	assert.match(writes[0]?.value ?? '', /"version": 1/);
	assert.deepEqual(shares, ['file:///cache/fressh-backup.json']);
	assert.deepEqual(deleted, ['file:///cache/fressh-backup.json']);
});

void test('exportBackupForSharing rejects when sharing is unavailable and still cleans up', async () => {
	const deleted: string[] = [];

	await assert.rejects(
		() =>
			exportBackupForSharing({
				createBackupPayload: async () => backupPayload,
				cacheDirectory: 'file:///cache/',
				writeAsString: async () => {},
				isSharingAvailable: async () => false,
				share: async () => {},
				deleteFile: async (path) => {
					deleted.push(path);
				},
			}),
		/Sharing is unavailable on this device/,
	);

	assert.deepEqual(deleted, ['file:///cache/fressh-backup.json']);
});

void test('exportBackupForSharing surfaces share failures and still cleans up', async () => {
	const deleted: string[] = [];

	await assert.rejects(
		() =>
			exportBackupForSharing({
				createBackupPayload: async () => backupPayload,
				cacheDirectory: 'file:///cache/',
				writeAsString: async () => {},
				isSharingAvailable: async () => true,
				share: async () => {
					throw new Error('share failed');
				},
				deleteFile: async (path) => {
					deleted.push(path);
				},
			}),
		/share failed/,
	);

	assert.deepEqual(deleted, ['file:///cache/fressh-backup.json']);
});

void test('loadBackupPayloadFromPicker returns cancelled when the picker is cancelled', async () => {
	const result = await loadBackupPayloadFromPicker({
		pickDocument: async () => ({ canceled: true }),
		readAsString: async () => {
			throw new Error('should not read');
		},
	});

	assert.deepEqual(result, { status: 'cancelled' });
});

void test('loadBackupPayloadFromPicker rejects invalid backup files', async () => {
	await assert.rejects(
		() =>
			loadBackupPayloadFromPicker({
				pickDocument: async () => ({
					canceled: false,
					assets: [{ uri: 'file:///cache/backup.json' }],
				}),
				readAsString: async () => '{invalid json',
			}),
		/Invalid backup format/,
	);
});

void test('restoreBackupPayload returns restore counts', async () => {
	const replacedKeys: BackupPayload['keys'][] = [];
	const replacedConnections: BackupPayload['connections'][] = [];

	const result = await restoreBackupPayload({
		payload: backupPayload,
		replaceAllKeys: async (entries) => {
			replacedKeys.push(entries);
		},
		replaceAllConnections: async (entries) => {
			replacedConnections.push(entries);
		},
	});

	assert.deepEqual(result, { restoredKeys: 1, restoredConnections: 1 });
	assert.deepEqual(replacedKeys, [backupPayload.keys]);
	assert.deepEqual(replacedConnections, [backupPayload.connections]);
});

void test('restoreBackupPayload surfaces restore failures', async () => {
	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				replaceAllKeys: async () => {
					throw new Error('replace failed');
				},
				replaceAllConnections: async () => {},
			}),
		/replace failed/,
	);
});
