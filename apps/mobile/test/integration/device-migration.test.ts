import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as z from 'zod';
import { makeBetterSecureStore } from '../../src/lib/chunked-storage';
import {
	createConnectionStorage,
	type StoredConnectionEntry,
} from '../../src/lib/connection-storage';
import {
	createBackupPayload,
	createReplaceAllPrivateKeyEntriesHandler,
	parseBackupPayload,
	replaceAllFromBackup,
	replaceAllPrivateKeys,
	validateBackupPayload,
} from '../../src/lib/device-migration';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function generatePrivateKeyFixture() {
	const tempDir = mkdtempSync(join(tmpdir(), 'fressh-private-key-fixture-'));
	const keyPath = join(tempDir, 'id_ed25519');
	try {
		const result = spawnSync(
			'ssh-keygen',
			['-q', '-t', 'ed25519', '-N', '', '-C', 'muly@dev-remote-machine', '-f', keyPath],
			{
				encoding: 'utf8',
			},
		);
		if (result.error) {
			throw new Error(`ssh-keygen unavailable: ${result.error.message}`);
		}
		if (result.status !== 0) {
			throw new Error(
				result.stderr.trim() || 'ssh-keygen failed to generate a key fixture.',
			);
		}
		return readFileSync(keyPath, 'utf8');
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function validatePrivateKeyWithSshKeygen(privateKey: string) {
	const tempDir = mkdtempSync(join(tmpdir(), 'fressh-private-key-'));
	const keyPath = join(tempDir, 'id_ed25519');
	try {
		writeFileSync(keyPath, privateKey, 'utf8');
		chmodSync(keyPath, 0o600);
		const result = spawnSync('ssh-keygen', ['-y', '-f', keyPath], {
			encoding: 'utf8',
		});
		if (result.error) {
			throw new Error(`ssh-keygen unavailable: ${result.error.message}`);
		}
		if (result.status === 0) return;
		throw new Error(
			'Invalid private key',
			{
				cause:
					result.stderr.trim() ||
					'ssh-keygen rejected the private key.',
			},
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
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

const validPrivateKey = generatePrivateKeyFixture();

const invalidPrivateKey = validPrivateKey.replace(
	'BEGIN OPENSSH PRIVATE KEY',
	'BEGIN OPENSSH PRIVATE KEYY',
);

const keyEntry = {
	id: 'key_1',
	metadata: {
		priority: 0,
		createdAtMs: 1,
		label: 'Primary key',
		isDefault: true,
	},
	value: validPrivateKey,
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

void test('createBackupPayload rejects saved connections that reference missing keys', async () => {
	await assert.rejects(
		() =>
			createBackupPayload({
				createdAt: '2026-04-09T00:00:00.000Z',
				listKeys: async () => [],
				listConnections: async () => [connectionEntry],
			}),
		/Missing private key for saved connection/,
	);
});

void test('createBackupPayload rejects duplicate key ids', async () => {
	await assert.rejects(
		() =>
			createBackupPayload({
				createdAt: '2026-04-09T00:00:00.000Z',
				listKeys: async () => [
					keyEntry,
					{
						...keyEntry,
						metadata: {
							...keyEntry.metadata,
							isDefault: false,
						},
						value: `${validPrivateKey}\n# duplicate`,
					},
				],
				listConnections: async () => [connectionEntry],
			}),
		/Duplicate private key id in backup: key_1/,
	);
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

void test('parseBackupPayload rejects connections that reference missing keys', () => {
	assert.throws(
		() =>
			parseBackupPayload(
				JSON.stringify({
					version: 1,
					createdAt: '2026-04-09T00:00:00.000Z',
					keys: [],
					connections: [connectionEntry],
				}),
			),
		/Missing private key for saved connection/,
	);
});

void test('parseBackupPayload rejects duplicate connection ids', () => {
	assert.throws(
		() =>
			parseBackupPayload(
				JSON.stringify({
					version: 1,
					createdAt: '2026-04-09T00:00:00.000Z',
					keys: [keyEntry],
					connections: [
						connectionEntry,
						{
							...connectionEntry,
							metadata: {
								...connectionEntry.metadata,
								label: 'Duplicate connection',
							},
						},
					],
				}),
			),
		/Duplicate saved connection id in backup: muly-dev-box-22/,
	);
});

void test('parseBackupPayload rejects multiple default keys', () => {
	assert.throws(
		() =>
			parseBackupPayload(
				JSON.stringify({
					version: 1,
					createdAt: '2026-04-09T00:00:00.000Z',
					keys: [
						keyEntry,
						{
							id: 'key_2',
							metadata: {
								priority: 1,
								createdAtMs: 2,
								label: 'Secondary key',
								isDefault: true,
							},
							value: validPrivateKey,
						},
					],
					connections: [
						connectionEntry,
						{
							...staleConnectionEntry,
							id: 'muly-dev-box-2222',
							value: {
								...staleConnectionEntry.value,
								host: 'dev-box-2',
								security: {
									...staleConnectionEntry.value.security,
									keyId: 'key_2',
								},
							},
						},
					],
				}),
			),
		/Backup must contain at most one default private key/,
	);
});

void test('validateBackupPayload rejects connections that reference missing keys', () => {
	assert.throws(
		() =>
			validateBackupPayload({
				version: 1,
				createdAt: '2026-04-09T00:00:00.000Z',
				keys: [],
				connections: [connectionEntry],
			}),
		/Missing private key for saved connection/,
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
			replaceAllPrivateKeys({
				entries: [
					{
						id: 'key_invalid',
						metadata: {
							priority: 0,
							createdAtMs: 1,
							label: 'Invalid',
							isDefault: false,
						},
						value: invalidPrivateKey,
					},
				],
				storage: keyStorage,
				validatePrivateKey: validatePrivateKeyWithSshKeygen,
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
			await replaceAllPrivateKeys({
				entries,
				storage: keyStorage,
				validatePrivateKey: validatePrivateKeyWithSshKeygen,
			});
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

void test(
	'replaceAllPrivateKeyEntries handler invalidates after replacing entries',
	async () => {
		const keyStorage = makeBetterSecureStore({
			storagePrefix: 'privateKey',
			extraManifestFieldsSchema: keyMetadataSchema,
			parseValue: (value) => value,
			storage: createMemoryAsyncStorage().storage,
			randomUUID: () => 'generated',
			logger: noopLogger,
		});
		await keyStorage.upsertEntry(staleKeyEntry);

		let invalidateCalls = 0;
		const replaceAllEntries = createReplaceAllPrivateKeyEntriesHandler({
			replaceAllKeys: async (entries) => {
				await replaceAllPrivateKeys({
					entries,
					storage: keyStorage,
					validatePrivateKey: validatePrivateKeyWithSshKeygen,
				});
			},
			invalidateKeysQuery: async () => {
				invalidateCalls += 1;
			},
		});

		await replaceAllEntries([keyEntry]);

		assert.equal(invalidateCalls, 1);
		assert.deepEqual(
			(await keyStorage.listEntriesWithValues()).map(
				({ id, metadata, value }) => ({ id, metadata, value }),
			),
			[keyEntry],
		);
	},
);
