import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { type BackupPayload } from '../../src/lib/device-migration';
import {
	createRestorePreflightSummary,
	exportBackupForSharing,
	loadBackupPayloadFromPicker,
	recoverPendingRestore,
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

function createMemoryRestoreJournal(options?: {
	failSaveAtCall?: number;
	failClear?: boolean;
	failLoad?: boolean;
}) {
	let state: unknown = null;
	let saveCalls = 0;
	let clearCalls = 0;
	let failClear = options?.failClear ?? false;
	return {
		load: async () => {
			if (options?.failLoad) {
				throw new Error('journal load failed');
			}
			return state;
		},
		save: async (nextState: unknown) => {
			saveCalls += 1;
			if (options?.failSaveAtCall === saveCalls) {
				throw new Error(`journal save failed on call ${saveCalls}`);
			}
			state = nextState;
		},
		clear: async () => {
			clearCalls += 1;
			if (failClear) {
				throw new Error('journal clear failed');
			}
			state = null;
		},
		setFailClear: (value: boolean) => {
			failClear = value;
		},
		getSnapshot: () => state,
		getClearCalls: () => clearCalls,
	};
}

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
	const journal = createMemoryRestoreJournal();

	const result = await restoreBackupPayload({
		payload: backupPayload,
		listCurrentKeys: async () => [],
		listCurrentConnections: async () => [],
		restoreJournal: journal,
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
	assert.equal(journal.getSnapshot(), null);
});

void test('restoreBackupPayload normalizes multi-default live keys before saving the restore journal snapshot', async () => {
	let currentKeys: BackupPayload['keys'] = [
		{
			id: 'key_live_1',
			metadata: {
				priority: 0,
				createdAtMs: 10,
				label: 'Live key one',
				isDefault: true,
			},
			value: 'LIVE KEY ONE',
		},
		{
			id: 'key_live_2',
			metadata: {
				priority: 1,
				createdAtMs: 11,
				label: 'Live key two',
				isDefault: true,
			},
			value: 'LIVE KEY TWO',
		},
	];
	let currentConnections: BackupPayload['connections'] = [
		{
			id: 'muly-live-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 12,
				modifiedAtMs: 13,
				label: 'Live Box',
			},
			value: {
				host: 'live-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_live_1',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	];
	const journal = createMemoryRestoreJournal({
		failClear: true,
	});

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				restoreJournal: journal,
				replaceAllKeys: async (entries) => {
					currentKeys = entries;
				},
				replaceAllConnections: async (entries) => {
					currentConnections = entries;
				},
			}),
		/journal clear failed/,
	);

	const savedState = journal.getSnapshot() as {
		phase: 'applied';
		previous: BackupPayload;
		target: BackupPayload;
	};
	assert.equal(savedState.phase, 'applied');
	assert.equal(
		savedState.previous.keys.filter((entry) => entry.metadata.isDefault).length,
		1,
	);
	assert.equal(savedState.previous.keys[0]?.metadata.isDefault, true);
	assert.equal(savedState.previous.keys[1]?.metadata.isDefault, false);

	journal.setFailClear(false);
	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async (entries) => {
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, { restored: false });
	assert.equal(journal.getSnapshot(), null);
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

void test('restoreBackupPayload rolls back even when saving the rollback target fails', async () => {
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
	const journal = createMemoryRestoreJournal({
		failSaveAtCall: 2,
	});

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				restoreJournal: journal,
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
		/journal save failed on call 2/,
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

void test('recoverPendingRestore reapplies the target snapshot after an interrupted restore', async () => {
	let currentKeys: BackupPayload['keys'] = [
		{
			id: 'key_partial',
			metadata: {
				priority: 0,
				createdAtMs: 7,
				label: 'Partial key',
				isDefault: false,
			},
			value: 'PARTIAL KEY',
		},
	];
	let currentConnections: BackupPayload['connections'] = [];
	const journal = createMemoryRestoreJournal();

	await journal.save({
		recoveryTarget: 'target',
		previous: {
			version: 1,
			createdAt: '2026-04-09T00:00:00.000Z',
			keys: [],
			connections: [],
		},
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async (entries) => {
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, {
		restored: true,
		recoveredTo: 'target',
		restoredKeys: 1,
		restoredConnections: 1,
	});
	assert.deepEqual(currentKeys, backupPayload.keys);
	assert.deepEqual(currentConnections, backupPayload.connections);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore reapplies the previous snapshot after an interrupted rollback', async () => {
	let currentKeys: BackupPayload['keys'] = backupPayload.keys;
	let currentConnections: BackupPayload['connections'] = [];
	const previousSnapshot: BackupPayload = {
		version: 1,
		createdAt: '2026-04-09T00:00:00.000Z',
		keys: [
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
		],
		connections: [
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
		],
	};
	const journal = createMemoryRestoreJournal();

	await journal.save({
		recoveryTarget: 'previous',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async (entries) => {
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, {
		restored: true,
		recoveredTo: 'previous',
		restoredKeys: 1,
		restoredConnections: 1,
	});
	assert.deepEqual(currentKeys, previousSnapshot.keys);
	assert.deepEqual(currentConnections, previousSnapshot.connections);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore clears a stale journal when current state already matches previous', async () => {
	const previousSnapshot: BackupPayload = {
		version: 1,
		createdAt: '2026-04-09T00:00:00.000Z',
		keys: [
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
		],
		connections: [
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
		],
	};
	const journal = createMemoryRestoreJournal();
	let replaceCalls = 0;

	await journal.save({
		recoveryTarget: 'previous',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => previousSnapshot.keys,
		listCurrentConnections: async () => previousSnapshot.connections,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, { restored: false });
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore does not replay a target journal when current state matches previous after local normalization even if key order drifted', async () => {
	const previousSnapshot: BackupPayload = {
		version: 1,
		createdAt: '2026-04-09T00:00:00.000Z',
		keys: [
			{
				id: 'key_live_1',
				metadata: {
					priority: 0,
					createdAtMs: 9,
					label: 'Live key one',
					isDefault: true,
				},
				value: 'LIVE KEY ONE',
			},
			{
				id: 'key_live_2',
				metadata: {
					priority: 1,
					createdAtMs: 10,
					label: 'Live key two',
					isDefault: false,
				},
				value: 'LIVE KEY TWO',
			},
		],
		connections: [
			{
				id: 'muly-live-box-22',
				metadata: {
					priority: 0,
					createdAtMs: 11,
					modifiedAtMs: 12,
					label: 'Live Box',
				},
				value: {
					host: 'live-box',
					port: 22,
					username: 'muly',
					security: {
						type: 'key' as const,
						keyId: 'key_live_1',
					},
					useTmux: true,
					tmuxSessionName: 'main',
					autoConnect: false,
				},
			},
		],
	};
	const currentKeys: BackupPayload['keys'] = [
		{
			id: 'key_live_2',
			metadata: {
				priority: 1,
				createdAtMs: 10,
				label: 'Live key two',
				isDefault: true,
			},
			value: 'LIVE KEY TWO',
		},
		{
			id: 'key_live_1',
			metadata: {
				priority: 0,
				createdAtMs: 9,
				label: 'Live key one',
				isDefault: true,
			},
			value: 'LIVE KEY ONE',
		},
	];
	const currentConnections = previousSnapshot.connections;
	const journal = createMemoryRestoreJournal();
	let replaceCalls = 0;

	await journal.save({
		recoveryTarget: 'target',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, { restored: false });
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore treats a completed journal as cleanup-only without readers after clear failure', async () => {
	let currentKeys: BackupPayload['keys'] = [];
	let currentConnections: BackupPayload['connections'] = [];
	const journal = createMemoryRestoreJournal({
		failClear: true,
	});

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				restoreJournal: journal,
				replaceAllKeys: async (entries) => {
					currentKeys = entries;
				},
				replaceAllConnections: async (entries) => {
					currentConnections = entries;
				},
			}),
		/journal clear failed/,
	);

	currentKeys = [
		{
			id: 'key_user_newer',
			metadata: {
				priority: 0,
				createdAtMs: 20,
				label: 'User newer key',
				isDefault: false,
			},
			value: 'USER NEWER KEY',
		},
	];
	currentConnections = [
		{
			id: 'muly-user-newer-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 21,
				modifiedAtMs: 22,
				label: 'User Newer Box',
			},
			value: {
				host: 'user-newer-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_user_newer',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	];

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		replaceAllKeys: async (entries) => {
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, {
		restored: false,
		completedJournalRetained: true,
	});
	assert.deepEqual(currentKeys, [
		{
			id: 'key_user_newer',
			metadata: {
				priority: 0,
				createdAtMs: 20,
				label: 'User newer key',
				isDefault: false,
			},
			value: 'USER NEWER KEY',
		},
	]);
	assert.deepEqual(currentConnections, [
		{
			id: 'muly-user-newer-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 21,
				modifiedAtMs: 22,
				label: 'User Newer Box',
			},
			value: {
				host: 'user-newer-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_user_newer',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	]);
	assert.notEqual(journal.getSnapshot(), null);
});

void test('recoverPendingRestore does not replay a completed restore journal over newer state after clear failure', async () => {
	let currentKeys: BackupPayload['keys'] = [];
	let currentConnections: BackupPayload['connections'] = [];
	const journal = createMemoryRestoreJournal({
		failClear: true,
	});

	await assert.rejects(
		() =>
			restoreBackupPayload({
				payload: backupPayload,
				listCurrentKeys: async () => currentKeys,
				listCurrentConnections: async () => currentConnections,
				restoreJournal: journal,
				replaceAllKeys: async (entries) => {
					currentKeys = entries;
				},
				replaceAllConnections: async (entries) => {
					currentConnections = entries;
				},
			}),
		/journal clear failed/,
	);

	journal.setFailClear(false);
	currentKeys = [
		{
			id: 'key_user_newer',
			metadata: {
				priority: 0,
				createdAtMs: 20,
				label: 'User newer key',
				isDefault: true,
			},
			value: 'USER NEWER KEY',
		},
	];
	currentConnections = [
		{
			id: 'muly-user-newer-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 21,
				modifiedAtMs: 22,
				label: 'User Newer Box',
			},
			value: {
				host: 'user-newer-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_user_newer',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	];
	let replaceCalls = 0;

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async (entries) => {
			replaceCalls += 1;
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			replaceCalls += 1;
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, { restored: false });
	assert.equal(replaceCalls, 0);
	assert.deepEqual(currentKeys, [
		{
			id: 'key_user_newer',
			metadata: {
				priority: 0,
				createdAtMs: 20,
				label: 'User newer key',
				isDefault: true,
			},
			value: 'USER NEWER KEY',
		},
	]);
	assert.deepEqual(currentConnections, [
		{
			id: 'muly-user-newer-box-22',
			metadata: {
				priority: 0,
				createdAtMs: 21,
				modifiedAtMs: 22,
				label: 'User Newer Box',
			},
			value: {
				host: 'user-newer-box',
				port: 22,
				username: 'muly',
				security: {
					type: 'key' as const,
					keyId: 'key_user_newer',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
		},
	]);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore supports legacy recoveryState journals', async () => {
	let currentKeys: BackupPayload['keys'] = backupPayload.keys;
	let currentConnections: BackupPayload['connections'] = [];
	const previousSnapshot: BackupPayload = {
		version: 1,
		createdAt: '2026-04-09T00:00:00.000Z',
		keys: [],
		connections: [],
	};
	const journal = createMemoryRestoreJournal();

	await journal.save({
		recoveryState: 'apply-previous',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => currentKeys,
		listCurrentConnections: async () => currentConnections,
		replaceAllKeys: async (entries) => {
			currentKeys = entries;
		},
		replaceAllConnections: async (entries) => {
			currentConnections = entries;
		},
	});

	assert.deepEqual(result, {
		restored: true,
		recoveredTo: 'previous',
		restoredKeys: 0,
		restoredConnections: 0,
	});
	assert.deepEqual(currentKeys, []);
	assert.deepEqual(currentConnections, []);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore normalizes legacy previous snapshots before validation', async () => {
	const journal = createMemoryRestoreJournal();
	const previousSnapshot: BackupPayload = {
		version: 1,
		createdAt: '2026-04-09T00:00:00.000Z',
		keys: [
			{
				id: 'key_live_1',
				metadata: {
					priority: 0,
					createdAtMs: 9,
					label: 'Live key one',
					isDefault: true,
				},
				value: 'LIVE KEY ONE',
			},
			{
				id: 'key_live_2',
				metadata: {
					priority: 1,
					createdAtMs: 10,
					label: 'Live key two',
					isDefault: true,
				},
				value: 'LIVE KEY TWO',
			},
		],
		connections: [
			{
				id: 'muly-live-box-22',
				metadata: {
					priority: 0,
					createdAtMs: 11,
					modifiedAtMs: 12,
					label: 'Live Box',
				},
				value: {
					host: 'live-box',
					port: 22,
					username: 'muly',
					security: {
						type: 'key' as const,
						keyId: 'key_live_1',
					},
					useTmux: true,
					tmuxSessionName: 'main',
					autoConnect: false,
				},
			},
		],
	};
	let replaceCalls = 0;

	await journal.save({
		recoveryState: 'apply-target',
		previous: previousSnapshot,
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => previousSnapshot.keys,
		listCurrentConnections: async () => previousSnapshot.connections,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, { restored: false });
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore clears a stale journal when current state already matches target', async () => {
	const journal = createMemoryRestoreJournal();
	let replaceCalls = 0;

	await journal.save({
		recoveryTarget: 'target',
		previous: {
			version: 1,
			createdAt: '2026-04-09T00:00:00.000Z',
			keys: [],
			connections: [],
		},
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		listCurrentKeys: async () => [...backupPayload.keys].reverse(),
		listCurrentConnections: async () => [...backupPayload.connections].reverse(),
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, { restored: false });
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
});

void test('recoverPendingRestore clears an invalid journal payload instead of throwing through startup', async () => {
	const journal = createMemoryRestoreJournal();
	let replaceCalls = 0;

	await journal.save({
		recoveryTarget: 'target',
		previous: {
			version: 1,
			createdAt: '2026-04-09T00:00:00.000Z',
			keys: [],
			connections: [backupPayload.connections[0]],
		},
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, {
		restored: false,
		clearedInvalidJournal: true,
	});
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
	assert.equal(journal.getClearCalls(), 1);
});

void test('recoverPendingRestore clears a journal when loading it fails', async () => {
	const journal = createMemoryRestoreJournal({
		failLoad: true,
	});
	let replaceCalls = 0;

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, {
		restored: false,
		clearedInvalidJournal: true,
	});
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
	assert.equal(journal.getClearCalls(), 1);
});

void test('recoverPendingRestore keeps an invalid journal non-fatal when clear fails', async () => {
	const journal = createMemoryRestoreJournal({
		failClear: true,
	});
	let replaceCalls = 0;

	await journal.save({
		recoveryTarget: 'target',
		previous: {
			version: 1,
			createdAt: '2026-04-09T00:00:00.000Z',
			keys: [],
			connections: [backupPayload.connections[0]],
		},
		target: backupPayload,
	});

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, {
		restored: false,
		clearedInvalidJournal: false,
		invalidJournalRetained: true,
	});
	assert.equal(replaceCalls, 0);
	assert.notEqual(journal.getSnapshot(), null);
	assert.equal(journal.getClearCalls(), 1);
});

void test('recoverPendingRestore keeps an unreadable journal non-fatal when clear fails', async () => {
	const journal = createMemoryRestoreJournal({
		failLoad: true,
		failClear: true,
	});
	let replaceCalls = 0;

	const result = await recoverPendingRestore({
		restoreJournal: journal,
		replaceAllKeys: async () => {
			replaceCalls += 1;
		},
		replaceAllConnections: async () => {
			replaceCalls += 1;
		},
	});

	assert.deepEqual(result, {
		restored: false,
		clearedInvalidJournal: false,
		invalidJournalRetained: true,
	});
	assert.equal(replaceCalls, 0);
	assert.equal(journal.getSnapshot(), null);
	assert.equal(journal.getClearCalls(), 1);
});

void test('secrets-manager wires recovery readers and propagates restore journal delete failures', () => {
	const source = readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			'../../src/lib/secrets-manager.ts',
		),
		'utf8',
	);

	assert.match(
		source,
		/recoverPendingRestore\(\{\s*restoreJournal,\s*listCurrentKeys:\s*\(\)\s*=>\s*betterKeyStorage\.listEntriesWithValues\(\),\s*listCurrentConnections:\s*\(\)\s*=>\s*connectionStorage\.listEntriesWithValues\(\),/s,
	);
	assert.match(
		source,
		/load:\s*async\s*\(\)\s*=>\s*\{[\s\S]*logger\.warn\('Discarding malformed restore journal entry', error\);[\s\S]*await restoreJournalStore\.deleteEntry\('pending'\);[\s\S]*return null;[\s\S]*\}/s,
	);
	assert.match(
		source,
		/clear:\s*async\s*\(\)\s*=>\s*\{\s*await restoreJournalStore\.deleteEntry\('pending'\);\s*\}/s,
	);
});
