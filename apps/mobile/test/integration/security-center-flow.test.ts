import assert from 'node:assert/strict';
import test from 'node:test';
import { type BackupPayload } from '../../src/lib/device-migration';
import {
	createRestorePreflightSummary,
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

void test('createRestorePreflightSummary lists restored keys and saved connections', () => {
	assert.deepEqual(createRestorePreflightSummary(backupPayload), {
		keys: [{ id: 'key_1', label: 'Primary key' }],
		connections: [
			{
				id: 'muly-dev-box-22',
				label: 'Dev Box (muly@dev-box:22)',
			},
		],
		message:
			'Keys to replace:\n- Primary key\n\nSaved connections to replace:\n- Dev Box (muly@dev-box:22)',
	});
});

void test('createRestorePreflightSummary preserves stable ids when labels collide', () => {
	const summary = createRestorePreflightSummary({
		...backupPayload,
		keys: [
			{
				id: 'key_1',
				metadata: {
					priority: 0,
					createdAtMs: 1,
					label: 'Shared label',
					isDefault: true,
				},
				value: 'PRIVATE KEY ONE',
			},
			{
				id: 'key_2',
				metadata: {
					priority: 0,
					createdAtMs: 2,
					label: 'Shared label',
					isDefault: false,
				},
				value: 'PRIVATE KEY TWO',
			},
		],
	});

	assert.deepEqual(summary.keys, [
		{ id: 'key_1', label: 'Shared label' },
		{ id: 'key_2', label: 'Shared label' },
	]);
});

void test('restoreBackupPayload returns restore counts', async () => {
	const replacedKeys: BackupPayload['keys'][] = [];
	const replacedConnections: BackupPayload['connections'][] = [];

	const result = await restoreBackupPayload({
		payload: backupPayload,
		listCurrentKeys: async () => [],
		listCurrentConnections: async () => [],
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
				listCurrentKeys: async () => [],
				listCurrentConnections: async () => [],
				replaceAllKeys: async () => {
					throw new Error('replace failed');
				},
				replaceAllConnections: async () => {},
			}),
		/replace failed/,
	);
});

void test('restoreBackupPayload rolls back the previous snapshot when connection replacement fails', async () => {
	let currentKeys: BackupPayload['keys'] = [
		{
			id: 'key_stale',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Stale key',
				isDefault: false,
			},
			value: 'STALE KEY',
		},
	];
	let currentConnections: BackupPayload['connections'] = [
		{
			id: 'muly-stale-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				modifiedAtMs: 11,
				label: 'Stale Box',
			},
			value: {
				host: 'stale-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_stale',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	];
	let connectionCalls = 0;

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				replaceAllKeys: async (entries) => {
					currentKeys = entries;
				},
				replaceAllConnections: async (entries) => {
					connectionCalls += 1;
					if (connectionCalls === 1) {
						throw new Error('connection replace failed');
					}
					currentConnections = entries;
				},
			}),
		/connection replace failed/,
	);

	assert.deepEqual(currentKeys, [
		{
			id: 'key_stale',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Stale key',
				isDefault: false,
			},
			value: 'STALE KEY',
		},
	]);
	assert.deepEqual(currentConnections, [
		{
			id: 'muly-stale-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				modifiedAtMs: 11,
				label: 'Stale Box',
			},
			value: {
				host: 'stale-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_stale',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	]);
});

void test('restoreBackupPayload rolls back the previous snapshot when key replacement fails mid-restore', async () => {
	let currentKeys: BackupPayload['keys'] = [
		{
			id: 'key_stale',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Stale key',
				isDefault: false,
			},
			value: 'STALE KEY',
		},
	];
	let currentConnections: BackupPayload['connections'] = [
		{
			id: 'muly-stale-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				modifiedAtMs: 11,
				label: 'Stale Box',
			},
			value: {
				host: 'stale-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_stale',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	];
	let keyCalls = 0;

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				replaceAllKeys: async (entries) => {
					keyCalls += 1;
					if (keyCalls === 1) {
						currentKeys = entries.slice(0, 1);
						throw new Error('key replace failed');
					}
					currentKeys = entries;
				},
				replaceAllConnections: async (entries) => {
					currentConnections = entries;
				},
			}),
		/key replace failed/,
	);

	assert.deepEqual(currentKeys, [
		{
			id: 'key_stale',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Stale key',
				isDefault: false,
			},
			value: 'STALE KEY',
		},
	]);
	assert.deepEqual(currentConnections, [
		{
			id: 'muly-stale-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				modifiedAtMs: 11,
				label: 'Stale Box',
			},
			value: {
				host: 'stale-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_stale',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	]);
});

void test('restoreBackupPayload reapplies the target snapshot when rollback fails', async () => {
	let currentKeys: BackupPayload['keys'] = [
		{
			id: 'key_stale',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Stale key',
				isDefault: false,
			},
			value: 'STALE KEY',
		},
	];
	let currentConnections: BackupPayload['connections'] = [
		{
			id: 'muly-stale-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				modifiedAtMs: 11,
				label: 'Stale Box',
			},
			value: {
				host: 'stale-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_stale',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	];
	let connectionCalls = 0;

	const result = await restoreBackupPayload({
		payload: backupPayload,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async (entries) => {
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			connectionCalls += 1;
			if (connectionCalls === 1) {
				currentConnections = entries;
				throw new Error('connection replace failed');
			}
			if (connectionCalls === 2) {
				throw new Error('rollback connections failed');
			}
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, {
		restoredKeys: 1,
		restoredConnections: 1,
		recoveredConsistency: true,
	});
	assert.deepEqual(currentKeys, backupPayload.keys);
	assert.deepEqual(currentConnections, backupPayload.connections);
});
