import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TEXT_ENTRY_HISTORY_STORAGE_KEY,
	clearRecentTextEntryHistory,
	createEmptyTextEntryHistoryState,
	createTextEntryHistoryId,
	createTextEntryHistoryStore,
	deleteTextEntryHistoryEntry,
	getTextEntryHistoryCycleEntries,
	getTextEntryHistorySections,
	parseTextEntryHistoryState,
	pinTextEntryHistoryEntry,
	pinTextEntryHistoryText,
	recordTextEntryPaste,
	serializeTextEntryHistoryState,
	unpinTextEntryHistoryEntry,
	type TextEntryHistoryState,
	type TextEntryHistoryStorage,
} from '../../src/lib/text-entry-history';
import {
	getTextEntryHistoryCursorEntry,
	getTextEntryHistoryCursorIndex,
	getTextEntryHistoryCursorLabel,
} from '../../src/lib/text-entry-history-cursor';
import {
	getCurrentTextPinAction,
	recordAcceptedTextEntryHistoryPaste,
	shouldStartTextEntryModalPanResponder,
	shouldTextEntryModalClaimDragMove,
} from '../../src/lib/text-entry-history-interactions';

const noopLogger = {
	warn: () => {},
};

function createMemoryStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
	const storage: TextEntryHistoryStorage = {
		getString: (key) => entries.get(key),
		set: (key, value) => {
			entries.set(key, value);
		},
		delete: (key) => {
			entries.delete(key);
		},
	};
	return { entries, storage };
}

function entryIds(state: TextEntryHistoryState) {
	return state.entries.map((entry) => entry.id);
}

void test('recordTextEntryPaste records non-empty text and ignores empty text', () => {
	const empty = createEmptyTextEntryHistoryState();
	const recorded = recordTextEntryPaste(empty, 'echo hi', {
		id: 'entry-1',
		nowMs: 100,
	});
	const unchanged = recordTextEntryPaste(recorded, '', {
		id: 'entry-2',
		nowMs: 200,
	});

	assert.deepEqual(recorded, {
		version: 1,
		entries: [
			{
				id: 'entry-1',
				text: 'echo hi',
				createdAtMs: 100,
				lastUsedAtMs: 100,
				pinned: false,
			},
		],
	});
	assert.deepEqual(unchanged, recorded);
});

void test('recordTextEntryPaste dedupes exact text and moves it to the top', () => {
	let state = createEmptyTextEntryHistoryState();
	state = recordTextEntryPaste(state, 'git status', {
		id: 'entry-1',
		nowMs: 100,
	});
	state = recordTextEntryPaste(state, 'pnpm test', {
		id: 'entry-2',
		nowMs: 200,
	});
	state = recordTextEntryPaste(state, 'git status', {
		id: 'entry-3',
		nowMs: 300,
	});

	assert.deepEqual(
		state.entries.map((entry) => ({
			id: entry.id,
			text: entry.text,
			createdAtMs: entry.createdAtMs,
			lastUsedAtMs: entry.lastUsedAtMs,
		})),
		[
			{
				id: 'entry-1',
				text: 'git status',
				createdAtMs: 100,
				lastUsedAtMs: 300,
			},
			{
				id: 'entry-2',
				text: 'pnpm test',
				createdAtMs: 200,
				lastUsedAtMs: 200,
			},
		],
	);
});

void test('recordTextEntryPaste derives a unique id when requested id collides', () => {
	const state = recordTextEntryPaste(
		createEmptyTextEntryHistoryState(),
		'echo hi',
		{
			id: 'entry-1',
			nowMs: 100,
		},
	);

	const updated = recordTextEntryPaste(state, 'pwd', {
		id: 'entry-1',
		nowMs: 200,
	});
	const ids = entryIds(updated);

	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual(
		parseTextEntryHistoryState(serializeTextEntryHistoryState(updated)),
		{
			state: updated,
			resetRequired: false,
		},
	);
});

void test('recordTextEntryPaste keeps only 50 unpinned recent entries', () => {
	let state = createEmptyTextEntryHistoryState();
	for (let i = 0; i < 55; i += 1) {
		state = recordTextEntryPaste(state, `cmd ${i}`, {
			id: `entry-${i}`,
			nowMs: i,
		});
	}

	assert.equal(state.entries.length, 50);
	assert.equal(state.entries[0]?.text, 'cmd 54');
	assert.equal(state.entries.at(-1)?.text, 'cmd 5');
	assert.equal(
		state.entries.some((entry) => entry.text === 'cmd 0'),
		false,
	);
});

void test('pinned entries do not count against recent retention and sort first', () => {
	let state = createEmptyTextEntryHistoryState();
	state = pinTextEntryHistoryText(state, 'deploy preview', {
		id: 'pin-1',
		nowMs: 1_000,
	});
	for (let i = 0; i < 50; i += 1) {
		state = recordTextEntryPaste(state, `cmd ${i}`, {
			id: `entry-${i}`,
			nowMs: i,
		});
	}

	assert.equal(state.entries.length, 51);
	assert.equal(state.entries[0]?.id, 'pin-1');
	assert.equal(state.entries[0]?.pinned, true);
	assert.equal(getTextEntryHistorySections(state).pinned.length, 1);
	assert.equal(getTextEntryHistorySections(state).recent.length, 50);
});

void test('pinTextEntryHistoryText pins existing recent text without duplicating it', () => {
	let state = createEmptyTextEntryHistoryState();
	state = recordTextEntryPaste(state, 'git status', {
		id: 'entry-1',
		nowMs: 100,
	});

	state = pinTextEntryHistoryText(state, 'git status', {
		id: 'new-pin-id',
		nowMs: 200,
	});

	assert.deepEqual(
		state.entries.map((entry) => ({
			id: entry.id,
			text: entry.text,
			pinned: entry.pinned,
			lastUsedAtMs: entry.lastUsedAtMs,
		})),
		[
			{
				id: 'entry-1',
				text: 'git status',
				pinned: true,
				lastUsedAtMs: 200,
			},
		],
	);
});

void test('pinTextEntryHistoryText derives a unique id when requested id collides', () => {
	const state = recordTextEntryPaste(
		createEmptyTextEntryHistoryState(),
		'echo hi',
		{
			id: 'entry-1',
			nowMs: 100,
		},
	);

	const updated = pinTextEntryHistoryText(state, 'deploy', {
		id: 'entry-1',
		nowMs: 200,
	});
	const ids = entryIds(updated);

	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual(
		parseTextEntryHistoryState(serializeTextEntryHistoryState(updated)),
		{
			state: updated,
			resetRequired: false,
		},
	);
});

void test('pinTextEntryHistoryText ignores empty text', () => {
	const state = createEmptyTextEntryHistoryState();
	const unchanged = pinTextEntryHistoryText(state, '', {
		id: 'pin-1',
		nowMs: 100,
	});

	assert.deepEqual(unchanged, state);
});

void test('multiple pinned entries sort newest first', () => {
	let state = createEmptyTextEntryHistoryState();
	state = pinTextEntryHistoryText(state, 'deploy preview', {
		id: 'pin-1',
		nowMs: 100,
	});
	state = pinTextEntryHistoryText(state, 'open logs', {
		id: 'pin-2',
		nowMs: 200,
	});

	assert.deepEqual(
		getTextEntryHistorySections(state).pinned.map((entry) => entry.id),
		['pin-2', 'pin-1'],
	);
	assert.deepEqual(entryIds(state), ['pin-2', 'pin-1']);
});

void test('pin, unpin, delete, and clear recent update state precisely', () => {
	let state = createEmptyTextEntryHistoryState();
	state = recordTextEntryPaste(state, 'git status', {
		id: 'entry-1',
		nowMs: 100,
	});
	state = recordTextEntryPaste(state, 'pnpm test', {
		id: 'entry-2',
		nowMs: 200,
	});
	state = pinTextEntryHistoryEntry(state, 'entry-1', { nowMs: 300 });
	assert.deepEqual(
		state.entries.map((entry) => ({
			id: entry.id,
			pinned: entry.pinned,
			lastUsedAtMs: entry.lastUsedAtMs,
		})),
		[
			{ id: 'entry-1', pinned: true, lastUsedAtMs: 300 },
			{ id: 'entry-2', pinned: false, lastUsedAtMs: 200 },
		],
	);

	state = unpinTextEntryHistoryEntry(state, 'entry-1', { nowMs: 400 });
	assert.deepEqual(
		state.entries.map((entry) => ({
			id: entry.id,
			pinned: entry.pinned,
			lastUsedAtMs: entry.lastUsedAtMs,
		})),
		[
			{ id: 'entry-1', pinned: false, lastUsedAtMs: 400 },
			{ id: 'entry-2', pinned: false, lastUsedAtMs: 200 },
		],
	);

	state = pinTextEntryHistoryEntry(state, 'entry-2', { nowMs: 500 });
	state = deleteTextEntryHistoryEntry(state, 'entry-1');
	assert.deepEqual(entryIds(state), ['entry-2']);

	state = recordTextEntryPaste(state, 'git diff', {
		id: 'entry-3',
		nowMs: 600,
	});
	state = clearRecentTextEntryHistory(state);
	assert.deepEqual(entryIds(state), ['entry-2']);
	assert.equal(state.entries[0]?.pinned, true);
});

void test('display helpers split sections and cycle through all entries in display order', () => {
	let state = createEmptyTextEntryHistoryState();
	state = recordTextEntryPaste(state, 'git status', {
		id: 'entry-1',
		nowMs: 100,
	});
	state = pinTextEntryHistoryText(state, 'deploy preview', {
		id: 'pin-1',
		nowMs: 200,
	});
	state = recordTextEntryPaste(state, 'pnpm test', {
		id: 'entry-2',
		nowMs: 300,
	});

	assert.deepEqual(
		getTextEntryHistorySections(state).pinned.map((entry) => entry.text),
		['deploy preview'],
	);
	assert.deepEqual(
		getTextEntryHistorySections(state).recent.map((entry) => entry.text),
		['pnpm test', 'git status'],
	);
	assert.deepEqual(
		getTextEntryHistoryCycleEntries(state).map((entry) => entry.text),
		['deploy preview', 'pnpm test', 'git status'],
	);
});

void test('history cursor resolves selected entry after entries reorder', () => {
	let state = createEmptyTextEntryHistoryState();
	state = recordTextEntryPaste(state, 'git status', {
		id: 'recent-1',
		nowMs: 100,
	});
	state = recordTextEntryPaste(state, 'pnpm test', {
		id: 'recent-2',
		nowMs: 200,
	});
	state = recordTextEntryPaste(state, 'ls', {
		id: 'recent-3',
		nowMs: 250,
	});
	state = pinTextEntryHistoryEntry(state, 'recent-1', { nowMs: 300 });

	const cycleEntries = getTextEntryHistoryCycleEntries(state);

	assert.deepEqual(
		cycleEntries.map((entry) => entry.id),
		['recent-1', 'recent-3', 'recent-2'],
	);
	assert.equal(getTextEntryHistoryCursorIndex(cycleEntries, 'recent-1'), 0);
	assert.equal(getTextEntryHistoryCursorLabel(cycleEntries, 'recent-1'), '1/3');
	assert.equal(
		getTextEntryHistoryCursorEntry(cycleEntries, 'recent-1', 'previous')?.id,
		'recent-3',
	);
	assert.equal(
		getTextEntryHistoryCursorEntry(cycleEntries, 'recent-1', 'next')?.id,
		'recent-2',
	);
});

void test('history cursor resets when selected entry disappears', () => {
	let state = createEmptyTextEntryHistoryState();
	state = recordTextEntryPaste(state, 'git status', {
		id: 'recent-1',
		nowMs: 100,
	});
	state = recordTextEntryPaste(state, 'pnpm test', {
		id: 'recent-2',
		nowMs: 200,
	});
	state = deleteTextEntryHistoryEntry(state, 'recent-2');

	const cycleEntries = getTextEntryHistoryCycleEntries(state);

	assert.equal(getTextEntryHistoryCursorIndex(cycleEntries, 'recent-2'), -1);
	assert.equal(getTextEntryHistoryCursorLabel(cycleEntries, 'recent-2'), '0/1');
	assert.equal(
		getTextEntryHistoryCursorEntry(cycleEntries, 'recent-2', 'previous')?.id,
		'recent-1',
	);
	assert.equal(
		getTextEntryHistoryCursorEntry(cycleEntries, 'recent-2', 'next')?.id,
		'recent-1',
	);
});

void test('parseTextEntryHistoryState returns empty state for missing or invalid data', () => {
	assert.deepEqual(parseTextEntryHistoryState(undefined), {
		state: createEmptyTextEntryHistoryState(),
		resetRequired: false,
	});
	assert.deepEqual(parseTextEntryHistoryState('{not json'), {
		state: createEmptyTextEntryHistoryState(),
		resetRequired: true,
	});
	assert.deepEqual(parseTextEntryHistoryState(JSON.stringify({ version: 2 })), {
		state: createEmptyTextEntryHistoryState(),
		resetRequired: true,
	});
	for (const invalidState of [
		{ version: 1 },
		{ version: 1, entries: [], unexpected: true },
		{ version: 1, entries: {} },
		{ version: 1, entries: [{ id: 'bad', text: 'missing fields' }] },
		{
			version: 1,
			entries: [
				{
					id: 'entry-1',
					text: 'echo hi',
					createdAtMs: 1,
					lastUsedAtMs: 1,
					pinned: false,
					unexpected: true,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 'entry-1',
					text: 'echo hi',
					createdAtMs: 1,
					lastUsedAtMs: 1,
					pinned: false,
				},
				{
					id: 'entry-1',
					text: 'pwd',
					createdAtMs: 2,
					lastUsedAtMs: 2,
					pinned: false,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 'entry-1',
					text: 'echo hi',
					createdAtMs: 1,
					lastUsedAtMs: 1,
					pinned: false,
				},
				{
					id: 'entry-2',
					text: 'echo hi',
					createdAtMs: 2,
					lastUsedAtMs: 2,
					pinned: false,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 'bad',
					text: 123,
					createdAtMs: 1,
					lastUsedAtMs: 1,
					pinned: true,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 123,
					text: 'bad id',
					createdAtMs: 1,
					lastUsedAtMs: 1,
					pinned: true,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 'bad',
					text: 'bad createdAtMs',
					createdAtMs: '1',
					lastUsedAtMs: 1,
					pinned: true,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 'bad',
					text: 'bad lastUsedAtMs',
					createdAtMs: 1,
					lastUsedAtMs: '1',
					pinned: true,
				},
			],
		},
		{
			version: 1,
			entries: [
				{
					id: 'bad',
					text: 'bad pinned',
					createdAtMs: 1,
					lastUsedAtMs: 1,
					pinned: 'true',
				},
			],
		},
	]) {
		assert.deepEqual(parseTextEntryHistoryState(JSON.stringify(invalidState)), {
			state: createEmptyTextEntryHistoryState(),
			resetRequired: true,
		});
	}
});

void test('serializeTextEntryHistoryState round-trips through parseTextEntryHistoryState', () => {
	const state = recordTextEntryPaste(
		createEmptyTextEntryHistoryState(),
		'echo hi',
		{
			id: 'entry-1',
			nowMs: 100,
		},
	);

	assert.deepEqual(
		parseTextEntryHistoryState(serializeTextEntryHistoryState(state)),
		{
			state,
			resetRequired: false,
		},
	);
});

void test('serializeTextEntryHistoryState projects to exact persisted shape', () => {
	const state = {
		...createEmptyTextEntryHistoryState(),
		unexpected: true,
		entries: [
			{
				id: 'entry-1',
				text: 'echo hi',
				createdAtMs: 100,
				lastUsedAtMs: 100,
				pinned: false,
				unexpected: true,
			},
		],
	} as unknown as TextEntryHistoryState;

	const serialized = serializeTextEntryHistoryState(state);
	const parsedJson = JSON.parse(serialized) as Record<string, unknown>;

	assert.deepEqual(Object.keys(parsedJson).sort(), ['entries', 'version']);
	assert.deepEqual(
		Object.keys(
			(parsedJson.entries as Record<string, unknown>[])[0] ?? {},
		).sort(),
		['createdAtMs', 'id', 'lastUsedAtMs', 'pinned', 'text'],
	);
	assert.deepEqual(parseTextEntryHistoryState(serialized), {
		state: {
			version: 1,
			entries: [
				{
					id: 'entry-1',
					text: 'echo hi',
					createdAtMs: 100,
					lastUsedAtMs: 100,
					pinned: false,
				},
			],
		},
		resetRequired: false,
	});
});

void test('createTextEntryHistoryId uses timestamp and injected random source', () => {
	assert.equal(
		createTextEntryHistoryId(1_000, () => 0.5),
		'teh_rs_4zsov',
	);
});

void test('createTextEntryHistoryStore persists changes and resets invalid storage', () => {
	const memory = createMemoryStorage({
		'textEntryHistory.state.v1': '{not json',
	});
	const warnings: unknown[][] = [];
	const store = createTextEntryHistoryStore({
		storage: memory.storage,
		logger: {
			warn: (...args: unknown[]) => {
				warnings.push(args);
			},
		},
		now: () => 100,
		random: () => 0.5,
	});

	assert.deepEqual(store.load(), createEmptyTextEntryHistoryState());
	assert.equal(memory.entries.get('textEntryHistory.state.v1'), undefined);
	assert.equal(warnings.length > 0, true);

	const state = store.recordPaste('echo hi');
	assert.equal(state.entries[0]?.text, 'echo hi');
	assert.equal(store.load().entries[0]?.text, 'echo hi');

	const persisted = memory.entries.get('textEntryHistory.state.v1');
	assert.equal(typeof persisted, 'string');
	assert.deepEqual(JSON.parse(persisted ?? ''), state);
});

void test('createTextEntryHistoryStore warns when invalid storage reset delete fails', () => {
	const warnings: unknown[][] = [];
	const store = createTextEntryHistoryStore({
		storage: {
			getString: () => '{not json',
			set: () => {},
			delete: () => {
				throw new Error('delete failed');
			},
		},
		logger: {
			warn: (...args: unknown[]) => {
				warnings.push(args);
			},
		},
		now: () => 100,
		random: () => 0.5,
	});

	assert.deepEqual(store.load(), createEmptyTextEntryHistoryState());
	assert.equal(warnings.length >= 2, true);
});

void test('createTextEntryHistoryStore persists all store mutation methods', () => {
	let nowMs = 1_000;
	const memory = createMemoryStorage();
	const store = createTextEntryHistoryStore({
		storage: memory.storage,
		logger: noopLogger,
		now: () => nowMs,
		random: () => 0.5,
	});
	const assertPersisted = (expected: TextEntryHistoryState) => {
		assert.deepEqual(store.load(), expected);
		const persisted = memory.entries.get('textEntryHistory.state.v1');
		assert.equal(typeof persisted, 'string');
		assert.deepEqual(JSON.parse(persisted ?? ''), expected);
	};

	let state = store.pinText('deploy preview');
	const pinnedId = state.entries[0]?.id ?? '';
	assert.equal(state.entries[0]?.pinned, true);
	assertPersisted(state);

	nowMs = 1_100;
	state = store.recordPaste('git status');
	const recentId =
		state.entries.find((entry) => entry.text === 'git status')?.id ?? '';
	assertPersisted(state);

	nowMs = 1_200;
	state = store.pinEntry(recentId);
	assert.equal(
		state.entries.find((entry) => entry.id === recentId)?.pinned,
		true,
	);
	assertPersisted(state);

	nowMs = 1_300;
	state = store.unpinEntry(recentId);
	assert.equal(
		state.entries.find((entry) => entry.id === recentId)?.pinned,
		false,
	);
	assertPersisted(state);

	state = store.deleteEntry(recentId);
	assert.equal(
		state.entries.some((entry) => entry.id === recentId),
		false,
	);
	assertPersisted(state);

	nowMs = 1_400;
	state = store.recordPaste('pnpm test');
	assertPersisted(state);

	state = store.clearRecent();
	assert.deepEqual(
		state.entries.map((entry) => entry.id),
		[pinnedId],
	);
	assertPersisted(state);
});

void test('createTextEntryHistoryStore deletes storage when deleting the last entry', () => {
	const memory = createMemoryStorage();
	const store = createTextEntryHistoryStore({
		storage: memory.storage,
		logger: noopLogger,
		now: () => 100,
		random: () => 0.5,
	});

	const state = store.recordPaste('echo hi');
	const entryId = state.entries[0]?.id ?? '';
	assert.equal(
		typeof memory.entries.get(TEXT_ENTRY_HISTORY_STORAGE_KEY),
		'string',
	);

	store.deleteEntry(entryId);

	assert.equal(memory.entries.get(TEXT_ENTRY_HISTORY_STORAGE_KEY), undefined);
});

void test('createTextEntryHistoryStore handles delete failures when persisting empty state', () => {
	const warnings: unknown[][] = [];
	const store = createTextEntryHistoryStore({
		storage: {
			getString: () =>
				JSON.stringify({
					version: 1,
					entries: [
						{
							id: 'entry-1',
							text: 'echo hi',
							createdAtMs: 100,
							lastUsedAtMs: 100,
							pinned: false,
						},
					],
				}),
			set: () => {},
			delete: () => {
				throw new Error('delete failed');
			},
		},
		logger: {
			warn: (...args: unknown[]) => {
				warnings.push(args);
			},
		},
		now: () => 100,
		random: () => 0.5,
	});

	const state = store.deleteEntry('entry-1');

	assert.deepEqual(state, createEmptyTextEntryHistoryState());
	assert.equal(warnings.length, 1);
	assert.equal(JSON.stringify(warnings).includes('echo hi'), false);
});

void test('createTextEntryHistoryStore avoids generated id collisions', () => {
	const existingId = createTextEntryHistoryId(100, () => 0.5);
	const memory = createMemoryStorage({
		[TEXT_ENTRY_HISTORY_STORAGE_KEY]: JSON.stringify({
			version: 1,
			entries: [
				{
					id: existingId,
					text: 'echo hi',
					createdAtMs: 100,
					lastUsedAtMs: 100,
					pinned: false,
				},
			],
		}),
	});
	const store = createTextEntryHistoryStore({
		storage: memory.storage,
		logger: noopLogger,
		now: () => 100,
		random: () => 0.5,
	});

	const state = store.recordPaste('pwd');
	const newEntry = state.entries.find((entry) => entry.text === 'pwd');

	assert.notEqual(newEntry?.id, existingId);
	assert.equal(new Set(state.entries.map((entry) => entry.id)).size, 2);
});

void test('createTextEntryHistoryStore returns updated in-memory state when persistence fails', () => {
	const warnings: unknown[][] = [];
	const store = createTextEntryHistoryStore({
		storage: {
			getString: () => undefined,
			set: () => {
				throw new Error('storage failed');
			},
			delete: () => {},
		},
		logger: {
			warn: (...args: unknown[]) => {
				warnings.push(args);
			},
		},
		now: () => 100,
		random: () => 0.5,
	});

	const state = store.recordPaste('echo hi');
	assert.equal(state.entries[0]?.text, 'echo hi');
	assert.equal(warnings.length > 0, true);
});

void test('createTextEntryHistoryStore recovers from storage read failures', () => {
	const warnings: unknown[][] = [];
	let setCalls = 0;
	let deleteCalls = 0;
	const store = createTextEntryHistoryStore({
		storage: {
			getString: () => {
				throw new Error('read failed');
			},
			set: () => {
				setCalls += 1;
			},
			delete: () => {
				deleteCalls += 1;
			},
		},
		logger: {
			warn: (...args: unknown[]) => {
				warnings.push(args);
			},
		},
		now: () => 100,
		random: () => 0.5,
	});

	assert.deepEqual(store.load(), createEmptyTextEntryHistoryState());
	const state = store.recordPaste('echo hi');
	assert.equal(state.entries[0]?.text, 'echo hi');
	assert.equal(warnings.length >= 2, true);
	assert.equal(setCalls, 0);
	assert.equal(deleteCalls, 0);
});

void test('current text pin action pins unmatched draft text', () => {
	assert.deepEqual(
		getCurrentTextPinAction({
			value: 'draft command',
			currentHistoryEntry: undefined,
		}),
		{ type: 'pin-text', text: 'draft command' },
	);
});

void test('current text pin action toggles existing history entries', () => {
	const recentEntry = {
		id: 'entry-1',
		text: 'git status',
		createdAtMs: 100,
		lastUsedAtMs: 100,
		pinned: false,
	};
	const pinnedEntry = {
		...recentEntry,
		pinned: true,
	};

	assert.deepEqual(
		getCurrentTextPinAction({
			value: 'git status',
			currentHistoryEntry: recentEntry,
		}),
		{ type: 'pin-entry', id: 'entry-1' },
	);
	assert.deepEqual(
		getCurrentTextPinAction({
			value: 'git status',
			currentHistoryEntry: pinnedEntry,
		}),
		{ type: 'unpin-entry', id: 'entry-1' },
	);
	assert.deepEqual(
		getCurrentTextPinAction({
			value: '',
			currentHistoryEntry: undefined,
		}),
		{ type: 'none' },
	);
});

void test('accepted text entry history paste records only accepted sends', () => {
	const recorded: string[] = [];
	const recordPaste = (text: string) => {
		recorded.push(text);
		return createEmptyTextEntryHistoryState();
	};

	assert.equal(
		recordAcceptedTextEntryHistoryPaste({
			accepted: false,
			historyText: 'blocked command',
			recordPaste,
		}),
		undefined,
	);
	assert.deepEqual(recorded, []);

	assert.deepEqual(
		recordAcceptedTextEntryHistoryPaste({
			accepted: true,
			historyText: 'sent command',
			recordPaste,
		}),
		createEmptyTextEntryHistoryState(),
	);
	assert.deepEqual(recorded, ['sent command']);
});

void test('text entry modal drag responder yields initial taps to controls', () => {
	assert.equal(shouldStartTextEntryModalPanResponder(), false);
	assert.equal(shouldTextEntryModalClaimDragMove({ dx: 1, dy: 1 }), false);
	assert.equal(shouldTextEntryModalClaimDragMove({ dx: 3, dy: 0 }), true);
	assert.equal(shouldTextEntryModalClaimDragMove({ dx: 0, dy: -3 }), true);
});
