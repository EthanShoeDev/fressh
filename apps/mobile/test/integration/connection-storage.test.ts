import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildChunkedStoreKeys,
	makeBetterSecureStore,
	type AsyncStringStorage,
} from '../../src/lib/chunked-storage';
import {
	connectionMetadataSchema,
	createConnectionStorage,
	storedConnectionDetailsSchema,
} from '../../src/lib/connection-storage';
import { connectAndRememberConnection } from '../../src/lib/ssh-connect-flow';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function createMemoryAsyncStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
	const storage: AsyncStringStorage = {
		getItem: async (key) => entries.get(key) ?? null,
		setItem: async (key, value) => {
			entries.set(key, value);
		},
		deleteItem: async (key) => {
			entries.delete(key);
		},
	};
	return { entries, storage };
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

void test(
	'missing legacy manifest chunks do not block SSH connect persistence',
	async () => {
		const legacyKeys = buildChunkedStoreKeys('connection');
		const { entries: legacyEntries, storage: legacyRawStorage } =
			createMemoryAsyncStorage({
				[legacyKeys.rootManifestKey]: JSON.stringify({
					manifestVersion: 1,
					manifestChunksIds: ['missing-manifest-chunk'],
				}),
			});
		const legacyConnectionStorage = makeBetterSecureStore({
			storagePrefix: 'connection',
			extraManifestFieldsSchema: connectionMetadataSchema,
			parseValue: (value) => storedConnectionDetailsSchema.parse(JSON.parse(value)),
			storage: legacyRawStorage,
			randomUUID: () => 'generated-manifest-chunk',
			logger: noopLogger,
		});
		const { entries: modernEntries, storage: modernStorage } =
			createMemoryStringStorage();
		const connectionStorage = createConnectionStorage({
			storage: modernStorage,
			legacyStorage: legacyConnectionStorage,
			logger: noopLogger,
			now: () => 1_234,
		});
		const fakeConnection = {
			connectionId: 'conn-1',
		};

		const result = await connectAndRememberConnection({
			connectionDetails: {
				host: 'dev-remote-machine-1',
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
			connect: async () => fakeConnection as never,
			saveConnection: async (params) => {
				await connectionStorage.upsertConnection(params);
			},
			abortSignalTimeoutMs: 1_000,
			resolvedSecurity: {
				type: 'key',
				privateKey: 'PRIVATE KEY',
			},
		});

		assert.equal(result.sshConnection, fakeConnection);
		const savedConnections = await connectionStorage.listEntriesWithValues();
		assert.equal(savedConnections.length, 1);
		assert.equal(savedConnections[0]?.value.host, 'dev-remote-machine-1');
		assert.equal(savedConnections[0]?.value.username, 'muly');
		assert.equal(savedConnections[0]?.value.useTmux, true);
		assert.equal(savedConnections[0]?.value.tmuxSessionName, 'main');
		assert.equal(savedConnections[0]?.metadata.createdAtMs, 1_234);
		assert.equal(savedConnections[0]?.metadata.modifiedAtMs, 1_234);
		assert.equal(
			modernEntries.get('connections.migrated-from-secure-store.v1'),
			'done',
		);
		assert.equal(legacyEntries.has(legacyKeys.rootManifestKey), false);
	},
);

void test(
	'legacy manifest read failures do not clear SecureStore or mark migration complete',
	async () => {
		const { entries: modernEntries, storage: modernStorage } =
			createMemoryStringStorage();
		let clearAllEntriesCalls = 0;
		const connectionStorage = createConnectionStorage({
			storage: modernStorage,
			legacyStorage: {
				listEntries: async () => {
					throw new Error('bad manifest');
				},
				getEntry: async () => {
					throw new Error('unreachable');
				},
				clearAllEntries: async () => {
					clearAllEntriesCalls += 1;
				},
			},
			logger: noopLogger,
			now: () => 4_321,
		});

		await connectionStorage.upsertConnection({
			details: {
				host: 'dev-remote-machine-2',
				port: 22,
				username: 'muly',
				security: {
					type: 'key',
					keyId: 'key_2',
				},
				useTmux: true,
				tmuxSessionName: 'main',
				autoConnect: false,
			},
			priority: 0,
			label: 'muly@dev-remote-machine-2:22',
		});

		const savedConnections = await connectionStorage.listEntriesWithValues();
		assert.equal(savedConnections.length, 1);
		assert.equal(clearAllEntriesCalls, 0);
		assert.equal(
			modernEntries.get('connections.migrated-from-secure-store.v1'),
			undefined,
		);
	},
);
