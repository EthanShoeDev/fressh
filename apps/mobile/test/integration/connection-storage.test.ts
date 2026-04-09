import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createConnectionStorage,
	type StoredConnectionEntry,
} from '../../src/lib/connection-storage';

const noopLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function createMemoryStringStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
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

const restoredConnection: StoredConnectionEntry = {
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

void test('replaceAllEntries clears legacy storage and marks migration complete', async () => {
	const mmkv = createMemoryStringStorage();
	let clearCalls = 0;
	let listCalls = 0;
	const connectionStorage = createConnectionStorage({
		storage: mmkv.storage,
		legacyStorage: {
			listEntries: async () => {
				listCalls += 1;
				throw new Error('manifest read failed');
			},
			getEntry: async () => {
				throw new Error('unreachable');
			},
			clearAllEntries: async () => {
				clearCalls += 1;
			},
		},
		logger: noopLogger,
		now: () => 1_000,
	});

	await connectionStorage.replaceAllEntries([restoredConnection]);

	assert.equal(clearCalls, 1);
	assert.equal(listCalls, 1);
	assert.equal(
		mmkv.entries.get('connections.migrated-from-secure-store.v1'),
		'done',
	);
});
