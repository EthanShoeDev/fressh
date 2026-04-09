import assert from 'node:assert/strict';
import test from 'node:test';
import { type StoredConnectionEntry } from '../../src/lib/connection-storage';
import {
	createBackupPayload,
	parseBackupPayload,
	replaceAllFromBackup,
} from '../../src/lib/device-migration';

const keyEntry = {
	id: 'key_1',
	metadata: {
		priority: 0,
		createdAtMs: 1,
		label: 'Primary key',
		isDefault: true,
	},
	value: 'PRIVATE KEY',
};

const connectionEntry: StoredConnectionEntry = {
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
			type: 'key',
			keyId: 'key_1',
		},
		useTmux: true,
		tmuxSessionName: 'main',
		autoConnect: false,
	},
};

void test('createBackupPayload preserves keys and saved connections', async () => {
	const payload = await createBackupPayload({
		createdAt: '2026-04-09T00:00:00.000Z',
		listKeys: async () => [keyEntry],
		listConnections: async () => [connectionEntry],
	});

	assert.equal(payload.version, 1);
	assert.deepEqual(payload.keys, [keyEntry]);
	assert.deepEqual(payload.connections, [connectionEntry]);
});

void test('parseBackupPayload rejects unsupported versions', () => {
	assert.throws(
		() =>
			parseBackupPayload(
				JSON.stringify({
					version: 99,
					createdAt: '2026-04-09T00:00:00.000Z',
					keys: [],
					connections: [],
				}),
			),
		/Unsupported backup version/,
	);
});

void test('replaceAllFromBackup replaces keys before saved connections', async () => {
	const calls: string[] = [];
	await replaceAllFromBackup({
		payload: parseBackupPayload(
			JSON.stringify({
				version: 1,
				createdAt: '2026-04-09T00:00:00.000Z',
				keys: [keyEntry],
				connections: [connectionEntry],
			}),
		),
		replaceAllKeys: async (entries) => {
			calls.push(`keys:${entries.length}`);
		},
		replaceAllConnections: async (entries) => {
			calls.push(`connections:${entries.length}`);
		},
	});

	assert.deepEqual(calls, ['keys:1', 'connections:1']);
});
