import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseShellConfigString } from '../../src/lib/shell-config';
import {
	loadInitialShellConfigState,
	reloadShellConfigFromRemote,
	type ShellConfigCacheStorage,
} from '../../src/lib/shell-config-store';

function createMemoryStorage(): ShellConfigCacheStorage {
	const values = new Map<string, string>();
	return {
		getString: (key) => values.get(key),
		set: (key, value) => {
			values.set(key, value);
		},
		delete: (key) => {
			values.delete(key);
		},
	};
}

const bundledConfigText = readFileSync(
	path.resolve(import.meta.dirname, '../../config/shell-config.json'),
	'utf8',
);
const bundledConfig = parseShellConfigString(bundledConfigText);

void test('initial shell config state uses bundled config when cache is empty', () => {
	const state = loadInitialShellConfigState({
		storage: createMemoryStorage(),
		bundledConfig,
	});

	assert.equal(state.source, 'bundled');
	assert.equal(state.config.version, bundledConfig.version);
	assert.equal(state.lastError, null);
});

void test('initial shell config state prefers cached config when it is valid', async () => {
	const storage = createMemoryStorage();
	const remoteText = JSON.stringify({
		...bundledConfig,
		version: 'runtime-v2',
		updatedAt: '2026-04-30T12:00:00.000Z',
	});

	await reloadShellConfigFromRemote({
		storage,
		fetchText: async () => remoteText,
		now: () => '2026-04-08T12:00:05.000Z',
	});

	const state = loadInitialShellConfigState({
		storage,
		bundledConfig,
	});

	assert.equal(state.source, 'cache');
	assert.equal(state.config.version, 'runtime-v2');
	assert.equal(state.lastError, null);
});

void test('initial shell config state ignores stale cached config', async () => {
	const storage = createMemoryStorage();
	const remoteText = JSON.stringify({
		...bundledConfig,
		version: 'runtime-v1',
		updatedAt: '2026-04-08T12:00:00.000Z',
	});

	await reloadShellConfigFromRemote({
		storage,
		fetchText: async () => remoteText,
		now: () => '2026-04-08T12:00:05.000Z',
	});

	const state = loadInitialShellConfigState({
		storage,
		bundledConfig,
	});

	assert.equal(state.source, 'bundled');
	assert.equal(state.config.version, bundledConfig.version);
	assert.equal(state.lastError, null);
});

void test('remote reload keeps the current config when fetched json is invalid', async () => {
	const storage = createMemoryStorage();
	const firstVersion = bundledConfig.version;

	await assert.rejects(() =>
		reloadShellConfigFromRemote({
			storage,
			fetchText: async () =>
				JSON.stringify({
					...bundledConfig,
					keyboards: bundledConfig.keyboards.map((keyboard, index) =>
						index === 0
							? {
									...keyboard,
									grid: keyboard.grid.map((row, rowIndex) =>
										rowIndex === 0
											? [
													{
														type: 'action',
														actionId: 'BROKEN_ACTION',
														label: 'Broken',
														icon: null,
													},
													...row.slice(1),
												]
											: row,
									),
								}
							: keyboard,
					),
				}),
			now: () => '2026-04-08T12:01:00.000Z',
		}),
		/BROKEN_ACTION/,
	);

	const state = loadInitialShellConfigState({
		storage,
		bundledConfig,
	});

	assert.equal(state.config.version, firstVersion);
	assert.equal(state.source, 'bundled');
	assert.match(state.lastError ?? '', /BROKEN_ACTION/);
});
