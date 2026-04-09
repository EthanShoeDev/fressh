import assert from 'node:assert/strict';
import test from 'node:test';
import * as z from 'zod';
import { makeBetterSecureStore } from '../../src/lib/chunked-storage';
import {
	createConnectionStorage,
	type StoredConnectionEntry,
} from '../../src/lib/connection-storage';
import {
	createBackupPayload,
	type BackupKeyEntry,
	parseBackupPayload,
	replaceAllFromBackup,
} from '../../src/lib/device-migration';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

async function replaceAllPrivateKeyEntries(params: {
	entries: BackupKeyEntry[];
	storage: {
		clearAllEntries: () => Promise<void>;
		upsertEntry: (entry: BackupKeyEntry) => Promise<void>;
	};
}) {
	for (const entry of params.entries) {
		if (!entry.value.startsWith('PRIVATE')) {
			throw new Error('Invalid private key');
		}
	}
	await params.storage.clearAllEntries();
	for (const entry of params.entries) {
		await params.storage.upsertEntry(entry);
	}
}

function createMemoryAsyncStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
	return {
		entries,
		storage: {
			getItem: async (key: string) => entries.get(key) ?? null,
			setItem: async (key: string, value: string) => {
				entries.set(key, value);
			},
			deleteItem: async (key: string) => {
				entries.delete(key);
			},
		},
	};
}

function createMemoryStringStorage() {
	const entries = new Map<string, string>();
	return {
		entries,
		storage: {
			getString: (key: string) => entries.get(key),
			set: (key: string, value: string) => {
				entries.set(key, value);
			},
			delete: (key: string) => {
				entries.delete(key);
			},
		},
	};
}

const keyMetadataSchema = z.object({
	priority: z.number(),
	createdAtMs: z.int(),
	label: z.string().optional(),
	isDefault: z.boolean().optional(),
});

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

const staleKeyEntry = {
	id: 'stale_key',
	metadata: {
		priority: 1,
		createdAtMs: 10,
		label: 'Stale key',
		isDefault: false,
	},
	value: 'STALE KEY',
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

const staleConnectionEntry: StoredConnectionEntry = {
	id: 'stale-user-dev-box-22',
	metadata: {
		priority: 1,
		createdAtMs: 11,
		modifiedAtMs: 12,
		label: 'Stale connection',
	},
	value: {
		host: 'stale-dev-box',
		port: 22,
		username: 'stale-user',
		security: {
			type: 'key',
			keyId: 'stale_key',
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

void test('replaceAllPrivateKeys keeps existing entries when validation fails', async () => {
	const keyStorage = makeBetterSecureStore({
		storagePrefix: 'privateKey',
		extraManifestFieldsSchema: keyMetadataSchema,
		parseValue: (value) => value,
		storage: createMemoryAsyncStorage().storage,
		randomUUID: () => 'generated',
		logger: noopLogger,
	});

	await keyStorage.upsertEntry(staleKeyEntry);

	await assert.rejects(
		() =>
			replaceAllPrivateKeyEntries({
				entries: [
					{
						id: 'key_invalid',
						metadata: {
							priority: 0,
							createdAtMs: 1,
							label: 'Invalid',
							isDefault: false,
						},
						value: 'BROKEN KEY',
					},
				],
				storage: keyStorage,
			}),
		/Invalid private key/,
	);

	assert.deepEqual(
		(await keyStorage.listEntriesWithValues()).map(
			({ id, metadata, value }) => ({ id, metadata, value }),
		),
		[staleKeyEntry],
	);
});

void test('replaceAllFromBackup replaces stale keys and connections in memory storage', async () => {
	const keyStorage = makeBetterSecureStore({
		storagePrefix: 'privateKey',
		extraManifestFieldsSchema: keyMetadataSchema,
		parseValue: (value) => value,
		storage: createMemoryAsyncStorage().storage,
		randomUUID: () => 'generated',
		logger: noopLogger,
	});
	const connectionStorage = createConnectionStorage({
		storage: createMemoryStringStorage().storage,
		legacyStorage: {
			listEntries: async () => [],
			getEntry: async () => {
				throw new Error('unreachable');
			},
			clearAllEntries: async () => {},
		},
		logger: noopLogger,
		now: () => 1_000,
	});

	await keyStorage.upsertEntry(staleKeyEntry);
	await connectionStorage.upsertConnection({
		details: staleConnectionEntry.value,
		priority: staleConnectionEntry.metadata.priority,
		label: staleConnectionEntry.metadata.label,
	});

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
			await replaceAllPrivateKeyEntries({ entries, storage: keyStorage });
		},
		replaceAllConnections: async (entries) => {
			await connectionStorage.replaceAllEntries(entries);
		},
	});

	assert.deepEqual(
		(await keyStorage.listEntriesWithValues()).map(({ id, metadata, value }) => ({
			id,
			metadata,
			value,
		})),
		[keyEntry],
	);
	assert.deepEqual(await connectionStorage.listEntriesWithValues(), [
		connectionEntry,
	]);
});
