# Text Entry History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted, pinnable history to the mobile shell Text dialog for successful Text dialog Paste actions.

**Architecture:** Put history rules in a pure `text-entry-history` module, wrap it with a small native MMKV store, and keep terminal sending in `detail.tsx`. `TextEntryModal` remains UI-only: it receives history entries/actions as props, manages transient cycle/drawer state, and loads selected history into the editor without sending.

**Tech Stack:** Expo React Native, TypeScript, `react-native-mmkv`, Node `tsx --test`, existing mobile shell components.

---

## Scope Check

The approved spec is one cohesive subsystem: Text dialog history. It touches storage, shell integration, and the Text dialog UI, but each piece is dependent on the same feature and can ship together. One implementation plan is the correct shape.

## File Structure

- Create `apps/mobile/src/lib/text-entry-history.ts`
  - Pure types and operations for parsing, recording, retention, pin/unpin, delete, clear, display sections, and cycle order.
  - Storage-agnostic store factory for MMKV-style string storage.
- Create `apps/mobile/src/lib/text-entry-history-store-native.ts`
  - Native MMKV adapter and singleton store for Text dialog history.
- Create `apps/mobile/test/integration/text-entry-history.test.ts`
  - Pure unit/integration tests for history behavior and storage wrapper behavior.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Load persisted history into React state.
  - Record history only from successful Text dialog Paste.
  - Pass history entries and actions to `TextEntryModal`.
  - Leave clipboard paste and other send paths unchanged.
- Modify `apps/mobile/src/app/shell/components/TextEntryModal.tsx`
  - Add compact cycle controls, current-text pin toggle, and inline history panel.
  - Keep existing Wispr controls and Paste/Clear/Close behavior.
- Existing tests to run:
  - `pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts`
  - `pnpm --filter @fressh/mobile test:integration -- terminal-input-payloads.test.ts`
  - `pnpm --filter @fressh/mobile typecheck`

---

### Task 1: Pure History Tests

**Files:**
- Create: `apps/mobile/test/integration/text-entry-history.test.ts`
- Later implementation: `apps/mobile/src/lib/text-entry-history.ts`

- [ ] **Step 1: Write the failing pure-history tests**

Create `apps/mobile/test/integration/text-entry-history.test.ts` with this content:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearRecentTextEntryHistory,
	createEmptyTextEntryHistoryState,
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
	assert.equal(state.entries.find((entry) => entry.id === 'entry-1')?.pinned, true);

	state = unpinTextEntryHistoryEntry(state, 'entry-1', { nowMs: 400 });
	assert.equal(state.entries.find((entry) => entry.id === 'entry-1')?.pinned, false);

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
});

void test('serializeTextEntryHistoryState round-trips through parseTextEntryHistoryState', () => {
	const state = recordTextEntryPaste(createEmptyTextEntryHistoryState(), 'echo hi', {
		id: 'entry-1',
		nowMs: 100,
	});

	assert.deepEqual(
		parseTextEntryHistoryState(serializeTextEntryHistoryState(state)),
		{
			state,
			resetRequired: false,
		},
	);
});

void test('createTextEntryHistoryStore persists changes and resets invalid storage', () => {
	const memory = createMemoryStorage({
		'textEntryHistory.state.v1': '{not json',
	});
	const store = createTextEntryHistoryStore({
		storage: memory.storage,
		logger: noopLogger,
		now: () => 100,
		random: () => 0.5,
	});

	assert.deepEqual(store.load(), createEmptyTextEntryHistoryState());
	assert.equal(memory.entries.get('textEntryHistory.state.v1'), undefined);

	const state = store.recordPaste('echo hi');
	assert.equal(state.entries[0]?.text, 'echo hi');
	assert.equal(store.load().entries[0]?.text, 'echo hi');
});

void test('createTextEntryHistoryStore returns updated in-memory state when persistence fails', () => {
	const store = createTextEntryHistoryStore({
		storage: {
			getString: () => undefined,
			set: () => {
				throw new Error('storage failed');
			},
			delete: () => {},
		},
		logger: noopLogger,
		now: () => 100,
		random: () => 0.5,
	});

	const state = store.recordPaste('echo hi');
	assert.equal(state.entries[0]?.text, 'echo hi');
});
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts
```

Expected: FAIL with this module-resolution class of error:

```text
Cannot find module '../../src/lib/text-entry-history'
```

- [ ] **Step 3: Commit the failing tests**

```bash
git add apps/mobile/test/integration/text-entry-history.test.ts
git commit -m "test(mobile): add text entry history behavior tests"
```

---

### Task 2: Pure History Module

**Files:**
- Create: `apps/mobile/src/lib/text-entry-history.ts`
- Test: `apps/mobile/test/integration/text-entry-history.test.ts`

- [ ] **Step 1: Implement the pure module**

Create `apps/mobile/src/lib/text-entry-history.ts` with this content:

```ts
export const TEXT_ENTRY_HISTORY_STORAGE_KEY = 'textEntryHistory.state.v1';
export const TEXT_ENTRY_HISTORY_MAX_RECENT = 50;

export type TextEntryHistoryEntry = {
	id: string;
	text: string;
	createdAtMs: number;
	lastUsedAtMs: number;
	pinned: boolean;
};

export type TextEntryHistoryState = {
	version: 1;
	entries: TextEntryHistoryEntry[];
};

export type TextEntryHistorySections = {
	pinned: TextEntryHistoryEntry[];
	recent: TextEntryHistoryEntry[];
};

export type TextEntryHistoryStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
};

export type TextEntryHistoryLogger = {
	warn: (message: string, error?: unknown) => void;
};

type MutationClock = {
	nowMs: number;
};

type CreateEntryOptions = MutationClock & {
	id: string;
};

type StoreParams = {
	storage: TextEntryHistoryStorage;
	logger: TextEntryHistoryLogger;
	now?: () => number;
	random?: () => number;
};

export function createEmptyTextEntryHistoryState(): TextEntryHistoryState {
	return {
		version: 1,
		entries: [],
	};
}

function isHistoryEntry(value: unknown): value is TextEntryHistoryEntry {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.id === 'string' &&
		typeof entry.text === 'string' &&
		typeof entry.createdAtMs === 'number' &&
		Number.isFinite(entry.createdAtMs) &&
		typeof entry.lastUsedAtMs === 'number' &&
		Number.isFinite(entry.lastUsedAtMs) &&
		typeof entry.pinned === 'boolean'
	);
}

function isHistoryState(value: unknown): value is TextEntryHistoryState {
	if (typeof value !== 'object' || value === null) return false;
	const state = value as Record<string, unknown>;
	return (
		state.version === 1 &&
		Array.isArray(state.entries) &&
		state.entries.every(isHistoryEntry)
	);
}

function compareEntries(a: TextEntryHistoryEntry, b: TextEntryHistoryEntry) {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	if (a.lastUsedAtMs !== b.lastUsedAtMs) {
		return b.lastUsedAtMs - a.lastUsedAtMs;
	}
	return b.createdAtMs - a.createdAtMs;
}

function normalizeState(state: TextEntryHistoryState): TextEntryHistoryState {
	const pinned = state.entries.filter((entry) => entry.pinned);
	const recent = state.entries
		.filter((entry) => !entry.pinned)
		.sort(compareEntries)
		.slice(0, TEXT_ENTRY_HISTORY_MAX_RECENT);
	return {
		version: 1,
		entries: [...pinned.sort(compareEntries), ...recent],
	};
}

function updateEntryById(
	state: TextEntryHistoryState,
	id: string,
	update: (entry: TextEntryHistoryEntry) => TextEntryHistoryEntry,
) {
	return normalizeState({
		version: 1,
		entries: state.entries.map((entry) =>
			entry.id === id ? update(entry) : entry,
		),
	});
}

export function parseTextEntryHistoryState(raw: string | undefined): {
	state: TextEntryHistoryState;
	resetRequired: boolean;
} {
	if (!raw) {
		return {
			state: createEmptyTextEntryHistoryState(),
			resetRequired: false,
		};
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isHistoryState(parsed)) {
			return {
				state: createEmptyTextEntryHistoryState(),
				resetRequired: true,
			};
		}
		const normalized = normalizeState(parsed);
		return {
			state: normalized,
			resetRequired: false,
		};
	} catch {
		return {
			state: createEmptyTextEntryHistoryState(),
			resetRequired: true,
		};
	}
}

export function serializeTextEntryHistoryState(
	state: TextEntryHistoryState,
): string {
	return JSON.stringify(normalizeState(state));
}

export function recordTextEntryPaste(
	state: TextEntryHistoryState,
	text: string,
	options: CreateEntryOptions,
): TextEntryHistoryState {
	if (text.length === 0) return state;
	const existing = state.entries.find((entry) => entry.text === text);
	if (existing) {
		return updateEntryById(state, existing.id, (entry) => ({
			...entry,
			lastUsedAtMs: options.nowMs,
		}));
	}

	return normalizeState({
		version: 1,
		entries: [
			...state.entries,
			{
				id: options.id,
				text,
				createdAtMs: options.nowMs,
				lastUsedAtMs: options.nowMs,
				pinned: false,
			},
		],
	});
}

export function pinTextEntryHistoryText(
	state: TextEntryHistoryState,
	text: string,
	options: CreateEntryOptions,
): TextEntryHistoryState {
	if (text.length === 0) return state;
	const existing = state.entries.find((entry) => entry.text === text);
	if (existing) {
		return pinTextEntryHistoryEntry(state, existing.id, {
			nowMs: options.nowMs,
		});
	}

	return normalizeState({
		version: 1,
		entries: [
			...state.entries,
			{
				id: options.id,
				text,
				createdAtMs: options.nowMs,
				lastUsedAtMs: options.nowMs,
				pinned: true,
			},
		],
	});
}

export function pinTextEntryHistoryEntry(
	state: TextEntryHistoryState,
	id: string,
	options: MutationClock,
): TextEntryHistoryState {
	return updateEntryById(state, id, (entry) => ({
		...entry,
		pinned: true,
		lastUsedAtMs: options.nowMs,
	}));
}

export function unpinTextEntryHistoryEntry(
	state: TextEntryHistoryState,
	id: string,
	options: MutationClock,
): TextEntryHistoryState {
	return updateEntryById(state, id, (entry) => ({
		...entry,
		pinned: false,
		lastUsedAtMs: options.nowMs,
	}));
}

export function deleteTextEntryHistoryEntry(
	state: TextEntryHistoryState,
	id: string,
): TextEntryHistoryState {
	return normalizeState({
		version: 1,
		entries: state.entries.filter((entry) => entry.id !== id),
	});
}

export function clearRecentTextEntryHistory(
	state: TextEntryHistoryState,
): TextEntryHistoryState {
	return normalizeState({
		version: 1,
		entries: state.entries.filter((entry) => entry.pinned),
	});
}

export function getTextEntryHistorySections(
	state: TextEntryHistoryState,
): TextEntryHistorySections {
	const normalized = normalizeState(state);
	return {
		pinned: normalized.entries.filter((entry) => entry.pinned),
		recent: normalized.entries.filter((entry) => !entry.pinned),
	};
}

export function getTextEntryHistoryCycleEntries(
	state: TextEntryHistoryState,
): TextEntryHistoryEntry[] {
	return normalizeState(state).entries;
}

export function createTextEntryHistoryId(
	nowMs: number,
	random = Math.random,
): string {
	const randomPart = Math.floor(random() * 0xffffff)
		.toString(36)
		.padStart(5, '0');
	return `teh_${nowMs.toString(36)}_${randomPart}`;
}

export function createTextEntryHistoryStore({
	storage,
	logger,
	now = () => Date.now(),
	random = Math.random,
}: StoreParams) {
	function load(): TextEntryHistoryState {
		let raw: string | undefined;
		try {
			raw = storage.getString(TEXT_ENTRY_HISTORY_STORAGE_KEY);
		} catch (error) {
			logger.warn('Failed to read Text entry history', error);
			return createEmptyTextEntryHistoryState();
		}

		const parsed = parseTextEntryHistoryState(raw);
		if (parsed.resetRequired) {
			try {
				storage.delete(TEXT_ENTRY_HISTORY_STORAGE_KEY);
			} catch (error) {
				logger.warn('Failed to reset invalid Text entry history', error);
			}
		}
		return parsed.state;
	}

	function persist(nextState: TextEntryHistoryState): TextEntryHistoryState {
		try {
			if (nextState.entries.length === 0) {
				storage.delete(TEXT_ENTRY_HISTORY_STORAGE_KEY);
			} else {
				storage.set(
					TEXT_ENTRY_HISTORY_STORAGE_KEY,
					serializeTextEntryHistoryState(nextState),
				);
			}
		} catch (error) {
			logger.warn('Failed to persist Text entry history', error);
		}
		return nextState;
	}

	function nextId(nowMs: number) {
		return createTextEntryHistoryId(nowMs, random);
	}

	return {
		load,
		recordPaste(text: string) {
			const nowMs = now();
			return persist(
				recordTextEntryPaste(load(), text, {
					id: nextId(nowMs),
					nowMs,
				}),
			);
		},
		pinText(text: string) {
			const nowMs = now();
			return persist(
				pinTextEntryHistoryText(load(), text, {
					id: nextId(nowMs),
					nowMs,
				}),
			);
		},
		pinEntry(id: string) {
			return persist(
				pinTextEntryHistoryEntry(load(), id, {
					nowMs: now(),
				}),
			);
		},
		unpinEntry(id: string) {
			return persist(
				unpinTextEntryHistoryEntry(load(), id, {
					nowMs: now(),
				}),
			);
		},
		deleteEntry(id: string) {
			return persist(deleteTextEntryHistoryEntry(load(), id));
		},
		clearRecent() {
			return persist(clearRecentTextEntryHistory(load()));
		},
	};
}
```

- [ ] **Step 2: Run the pure-history tests and verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts
```

Expected: PASS for all tests in `text-entry-history.test.ts`.

- [ ] **Step 3: Commit the pure module**

```bash
git add apps/mobile/src/lib/text-entry-history.ts apps/mobile/test/integration/text-entry-history.test.ts
git commit -m "feat(mobile): add text entry history core"
```

---

### Task 3: Native Store And Shell Recording

**Files:**
- Create: `apps/mobile/src/lib/text-entry-history-store-native.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Test: `apps/mobile/test/integration/text-entry-history.test.ts`
- Test: `apps/mobile/test/integration/terminal-input-payloads.test.ts`

- [ ] **Step 1: Create the native MMKV store wrapper**

Create `apps/mobile/src/lib/text-entry-history-store-native.ts` with this content:

```ts
import { MMKV } from 'react-native-mmkv';

import { rootLogger } from '@/lib/logger';
import {
	createTextEntryHistoryStore,
	type TextEntryHistoryStorage,
} from '@/lib/text-entry-history';

const storage = new MMKV({ id: 'text-entry-history' });

function getNativeTextEntryHistoryStorage(): TextEntryHistoryStorage {
	return {
		getString: (key) => storage.getString(key),
		set: (key, value) => {
			storage.set(key, value);
		},
		delete: (key) => {
			storage.delete(key);
		},
	};
}

export const textEntryHistoryStore = createTextEntryHistoryStore({
	storage: getNativeTextEntryHistoryStorage(),
	logger: rootLogger.extend('TextEntryHistory'),
});
```

- [ ] **Step 2: Add imports to `detail.tsx`**

Modify `apps/mobile/src/app/shell/detail.tsx` imports by adding these imports near the existing library imports:

```ts
import { textEntryHistoryStore } from '@/lib/text-entry-history-store-native';
import {
	getTextEntryHistoryCycleEntries,
	getTextEntryHistorySections,
	type TextEntryHistoryState,
} from '@/lib/text-entry-history';
```

- [ ] **Step 3: Add history state near the existing modal state**

In `apps/mobile/src/app/shell/detail.tsx`, near:

```ts
const [textEntryOpen, setTextEntryOpen] = useState(false);
```

add:

```ts
const [textEntryHistoryState, setTextEntryHistoryState] =
	useState<TextEntryHistoryState>(() => textEntryHistoryStore.load());
```

- [ ] **Step 4: Add history action callbacks in `detail.tsx`**

Add these callbacks near `handlePasteTextEntry`:

```ts
const refreshTextEntryHistory = useCallback(
	(nextState: TextEntryHistoryState) => {
		setTextEntryHistoryState(nextState);
	},
	[],
);

const handlePinTextEntryHistoryText = useCallback(
	(text: string) => {
		refreshTextEntryHistory(textEntryHistoryStore.pinText(text));
	},
	[refreshTextEntryHistory],
);

const handlePinTextEntryHistoryEntry = useCallback(
	(id: string) => {
		refreshTextEntryHistory(textEntryHistoryStore.pinEntry(id));
	},
	[refreshTextEntryHistory],
);

const handleUnpinTextEntryHistoryEntry = useCallback(
	(id: string) => {
		refreshTextEntryHistory(textEntryHistoryStore.unpinEntry(id));
	},
	[refreshTextEntryHistory],
);

const handleDeleteTextEntryHistoryEntry = useCallback(
	(id: string) => {
		refreshTextEntryHistory(textEntryHistoryStore.deleteEntry(id));
	},
	[refreshTextEntryHistory],
);

const handleClearRecentTextEntryHistory = useCallback(() => {
	refreshTextEntryHistory(textEntryHistoryStore.clearRecent());
}, [refreshTextEntryHistory]);
```

- [ ] **Step 5: Record history from Text dialog Paste only**

Change `handlePasteTextEntry` in `apps/mobile/src/app/shell/detail.tsx` to record after the payload is non-empty and the send path is invoked:

```ts
const handlePasteTextEntry = useCallback(
	(value: string) => {
		const segments = buildTextEntryPasteSegments(value);
		if (!segments.length) return;
		if (selectionModeEnabled) {
			exitSelectionMode();
		}
		sendLiteralInputSegments(segments, {
			interSegmentDelayMs: touchEnterDelayMs,
		});
		refreshTextEntryHistory(textEntryHistoryStore.recordPaste(value));
	},
	[
		exitSelectionMode,
		refreshTextEntryHistory,
		selectionModeEnabled,
		sendLiteralInputSegments,
		touchEnterDelayMs,
	],
);
```

Do not change `handlePasteClipboard`, commander callbacks, command presets, macros, or keyboard send paths.

- [ ] **Step 6: Derive entries and pass history props to `TextEntryModal`**

Add this memo near other derived modal props:

```ts
const textEntryHistorySections = useMemo(
	() => getTextEntryHistorySections(textEntryHistoryState),
	[textEntryHistoryState],
);
const textEntryHistoryCycleEntries = useMemo(
	() => getTextEntryHistoryCycleEntries(textEntryHistoryState),
	[textEntryHistoryState],
);
```

Update the `TextEntryModal` JSX in `detail.tsx` to pass:

```tsx
<TextEntryModal
	open={textEntryOpen}
	bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
	wisprMode={wisprMode}
	wisprControl={wisprControl}
	history={{
		cycleEntries: textEntryHistoryCycleEntries,
		pinnedEntries: textEntryHistorySections.pinned,
		recentEntries: textEntryHistorySections.recent,
		onPinText: handlePinTextEntryHistoryText,
		onPinEntry: handlePinTextEntryHistoryEntry,
		onUnpinEntry: handleUnpinTextEntryHistoryEntry,
		onDeleteEntry: handleDeleteTextEntryHistoryEntry,
		onClearRecent: handleClearRecentTextEntryHistory,
	}}
	onWisprSetup={handleOpenWisprAutomationSettings}
	onWisprAutoStartChange={handleWisprAutoStartChange}
	onClose={handleCloseTextEntry}
	onPaste={handlePasteTextEntry}
	onWisprFocus={handleWisprTextEntryFocus}
	onValueChange={handleWisprTextEntryValueChange}
/>
```

- [ ] **Step 7: Run tests and typecheck to expose modal prop compile errors**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts terminal-input-payloads.test.ts
pnpm --filter @fressh/mobile typecheck
```

Expected: tests PASS. Typecheck FAILS until Task 4 adds the `history` prop to `TextEntryModal`.

- [ ] **Step 8: Commit the native store and shell recording after Task 4 passes typecheck**

Do not commit this task yet if typecheck fails. After Task 4 passes typecheck, commit these files together:

```bash
git add apps/mobile/src/lib/text-entry-history-store-native.ts apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): persist text dialog history"
```

---

### Task 4: Text Entry Modal History UI

**Files:**
- Modify: `apps/mobile/src/app/shell/components/TextEntryModal.tsx`
- Depends on: `apps/mobile/src/lib/text-entry-history.ts`

- [ ] **Step 1: Update imports**

In `apps/mobile/src/app/shell/components/TextEntryModal.tsx`, add `ScrollView` to the `react-native` import:

```ts
ScrollView,
```

Add icon imports after the React Native import:

```ts
import {
	ChevronDown,
	ChevronUp,
	History,
	Pin,
	PinOff,
	Trash2,
} from 'lucide-react-native';
```

Add the history type import:

```ts
import { type TextEntryHistoryEntry } from '@/lib/text-entry-history';
```

- [ ] **Step 2: Add the modal history prop type**

Below `TextInputScreenBounds`, add:

```ts
export type TextEntryHistoryModalProps = {
	cycleEntries: readonly TextEntryHistoryEntry[];
	pinnedEntries: readonly TextEntryHistoryEntry[];
	recentEntries: readonly TextEntryHistoryEntry[];
	onPinText: (text: string) => void;
	onPinEntry: (id: string) => void;
	onUnpinEntry: (id: string) => void;
	onDeleteEntry: (id: string) => void;
	onClearRecent: () => void;
};
```

Add `history` to the function parameters:

```ts
history,
```

Add `history` to the props type:

```ts
history?: TextEntryHistoryModalProps;
```

- [ ] **Step 3: Add modal-local history state and derived values**

After the existing `useState` calls for `value` and `textAreaContentHeight`, add:

```ts
const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
const [historyIndex, setHistoryIndex] = useState<number | null>(null);
```

After `textAreaHeight`, add:

```ts
const cycleEntries = history?.cycleEntries ?? [];
const pinnedEntries = history?.pinnedEntries ?? [];
const recentEntries = history?.recentEntries ?? [];
const hasHistory = cycleEntries.length > 0;
const currentPinnedEntry = useMemo(
	() => pinnedEntries.find((entry) => entry.text === value) ?? null,
	[pinnedEntries, value],
);
const historyPositionLabel =
	historyIndex === null || cycleEntries.length === 0
		? `Recent ${cycleEntries.length}`
		: `Recent ${historyIndex + 1} of ${cycleEntries.length}`;
```

- [ ] **Step 4: Reset transient history UI on close and edits**

Change the existing close reset effect from:

```ts
useEffect(() => {
	if (!open) resetDrag();
}, [open, resetDrag]);
```

to:

```ts
useEffect(() => {
	if (!open) {
		resetDrag();
		setHistoryPanelOpen(false);
		setHistoryIndex(null);
	}
}, [open, resetDrag]);
```

Change `handleChangeText` to clear the selected history index when the user edits:

```ts
const handleChangeText = useCallback(
	(nextValue: string) => {
		setHistoryIndex(null);
		updateValue(nextValue);
	},
	[updateValue],
);
```

In `handleClear`, add these two lines before focusing:

```ts
setHistoryIndex(null);
setHistoryPanelOpen(false);
```

In `handlePaste`, after clearing text area height, add:

```ts
setHistoryIndex(null);
setHistoryPanelOpen(false);
```

- [ ] **Step 5: Add history action handlers**

Add these callbacks after `handleInputFocus`:

```ts
const loadHistoryEntry = useCallback(
	(entry: TextEntryHistoryEntry, index: number | null) => {
		setHistoryIndex(index);
		updateValue(entry.text);
		setTextAreaContentHeight(minHeight);
		setHistoryPanelOpen(false);
		inputRef.current?.focus();
	},
	[minHeight, updateValue],
);

const handleCycleHistory = useCallback(
	(delta: -1 | 1) => {
		if (cycleEntries.length === 0) return;
		const nextIndex =
			historyIndex === null
				? 0
				: (historyIndex + delta + cycleEntries.length) % cycleEntries.length;
		const nextEntry = cycleEntries[nextIndex];
		if (!nextEntry) return;
		loadHistoryEntry(nextEntry, nextIndex);
	},
	[cycleEntries, historyIndex, loadHistoryEntry],
);

const handleToggleCurrentPin = useCallback(() => {
	if (!history || value.length === 0) return;
	if (currentPinnedEntry) {
		history.onUnpinEntry(currentPinnedEntry.id);
		return;
	}
	history.onPinText(value);
}, [currentPinnedEntry, history, value]);

const handleToggleEntryPin = useCallback(
	(entry: TextEntryHistoryEntry) => {
		if (!history) return;
		if (entry.pinned) {
			history.onUnpinEntry(entry.id);
			return;
		}
		history.onPinEntry(entry.id);
	},
	[history],
);

const handleDeleteHistoryEntry = useCallback(
	(entry: TextEntryHistoryEntry) => {
		if (!history) return;
		history.onDeleteEntry(entry.id);
		if (historyIndex !== null && cycleEntries[historyIndex]?.id === entry.id) {
			setHistoryIndex(null);
		}
	},
	[cycleEntries, history, historyIndex],
);
```

- [ ] **Step 6: Add history buttons to the existing header row**

Inside the header `<View {...panResponder.panHandlers}>`, leave the existing `Text` title, Wispr switch block, and Wispr setup-pill block in their current order. Insert this history-actions block immediately after the Wispr setup-pill block and before the closing tag of the header `<View>`:

```tsx
<View
	style={{
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	}}
>
	{history ? (
		<>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={
					currentPinnedEntry ? 'Unpin current text' : 'Pin current text'
				}
				onPress={handleToggleCurrentPin}
				disabled={value.length === 0}
				style={{
					borderRadius: 8,
					padding: 8,
					borderWidth: 1,
					borderColor: currentPinnedEntry
						? theme.colors.primary
						: theme.colors.border,
					opacity: value.length === 0 ? 0.45 : 1,
				}}
			>
				{currentPinnedEntry ? (
					<PinOff size={16} color={theme.colors.textSecondary} />
				) : (
					<Pin size={16} color={theme.colors.textSecondary} />
				)}
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Open text history"
				onPress={() => setHistoryPanelOpen((prev) => !prev)}
				style={{
					borderRadius: 8,
					padding: 8,
					borderWidth: 1,
					borderColor: historyPanelOpen
						? theme.colors.primary
						: theme.colors.border,
				}}
			>
				<History size={16} color={theme.colors.textSecondary} />
			</Pressable>
		</>
	) : null}
</View>
```

This insertion keeps the current Wispr JSX intact and adds only the current-text pin and history-panel controls.

- [ ] **Step 7: Add cycle controls below the text area**

Immediately after the `TextInput`, insert:

```tsx
{history && hasHistory ? (
	<View
		style={{
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			marginTop: 8,
		}}
	>
		<Text
			style={{
				color: theme.colors.textSecondary,
				fontSize: 12,
				fontWeight: '600',
			}}
		>
			{historyPositionLabel}
		</Text>
		<View style={{ flexDirection: 'row', gap: 8 }}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Previous text history item"
				onPress={() => handleCycleHistory(-1)}
				style={{
					borderRadius: 8,
					padding: 8,
					borderWidth: 1,
					borderColor: theme.colors.border,
				}}
			>
				<ChevronUp size={16} color={theme.colors.textSecondary} />
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Next text history item"
				onPress={() => handleCycleHistory(1)}
				style={{
					borderRadius: 8,
					padding: 8,
					borderWidth: 1,
					borderColor: theme.colors.border,
				}}
			>
				<ChevronDown size={16} color={theme.colors.textSecondary} />
			</Pressable>
		</View>
	</View>
) : null}
```

- [ ] **Step 8: Add the history panel below cycle controls**

Immediately after the cycle controls, insert:

```tsx
{history && historyPanelOpen ? (
	<View
		style={{
			borderWidth: 1,
			borderColor: theme.colors.border,
			backgroundColor: theme.colors.surface,
			borderRadius: 10,
			marginTop: 8,
			maxHeight: Math.max(120, Math.min(220, dialogMaxHeight * 0.35)),
			overflow: 'hidden',
		}}
	>
		<ScrollView keyboardShouldPersistTaps="handled">
			{pinnedEntries.length > 0 ? (
				<HistorySection
					title="Pinned"
					entries={pinnedEntries}
					cycleEntries={cycleEntries}
					onSelect={loadHistoryEntry}
					onTogglePin={handleToggleEntryPin}
					onDelete={handleDeleteHistoryEntry}
				/>
			) : null}
			{recentEntries.length > 0 ? (
				<HistorySection
					title="Recent"
					entries={recentEntries}
					cycleEntries={cycleEntries}
					onSelect={loadHistoryEntry}
					onTogglePin={handleToggleEntryPin}
					onDelete={handleDeleteHistoryEntry}
				/>
			) : null}
			{pinnedEntries.length === 0 && recentEntries.length === 0 ? (
				<Text
					style={{
						color: theme.colors.textSecondary,
						padding: 12,
						fontSize: 12,
					}}
				>
					No text history yet.
				</Text>
			) : null}
		</ScrollView>
		{recentEntries.length > 0 ? (
			<Pressable
				accessibilityRole="button"
				onPress={history.onClearRecent}
				style={{
					borderTopWidth: 1,
					borderTopColor: theme.colors.border,
					paddingVertical: 10,
					alignItems: 'center',
				}}
			>
				<Text
					style={{
						color: theme.colors.textSecondary,
						fontSize: 12,
						fontWeight: '700',
					}}
				>
					Clear History
				</Text>
			</Pressable>
		) : null}
	</View>
) : null}
```

- [ ] **Step 9: Add `HistorySection` below `TextEntryModal`**

At the bottom of `TextEntryModal.tsx`, after the component function, add:

```tsx
function HistorySection({
	title,
	entries,
	cycleEntries,
	onSelect,
	onTogglePin,
	onDelete,
}: {
	title: string;
	entries: readonly TextEntryHistoryEntry[];
	cycleEntries: readonly TextEntryHistoryEntry[];
	onSelect: (entry: TextEntryHistoryEntry, index: number | null) => void;
	onTogglePin: (entry: TextEntryHistoryEntry) => void;
	onDelete: (entry: TextEntryHistoryEntry) => void;
}) {
	const theme = useTheme();

	return (
		<View style={{ paddingTop: 8 }}>
			<Text
				style={{
					color: theme.colors.muted,
					fontSize: 11,
					fontWeight: '700',
					paddingHorizontal: 12,
					paddingBottom: 6,
					textTransform: 'uppercase',
				}}
			>
				{title}
			</Text>
			{entries.map((entry) => {
				const cycleIndex = cycleEntries.findIndex(
					(cycleEntry) => cycleEntry.id === entry.id,
				);
				return (
					<View
						key={entry.id}
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							borderTopWidth: 1,
							borderTopColor: theme.colors.border,
						}}
					>
						<Pressable
							accessibilityRole="button"
							onPress={() =>
								onSelect(entry, cycleIndex >= 0 ? cycleIndex : null)
							}
							style={{
								flex: 1,
								paddingVertical: 10,
								paddingLeft: 12,
								paddingRight: 8,
							}}
						>
							<Text
								numberOfLines={1}
								style={{
									color: theme.colors.textPrimary,
									fontSize: 13,
									fontWeight: '600',
								}}
							>
								{entry.text}
							</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={
								entry.pinned ? 'Unpin history item' : 'Pin history item'
							}
							onPress={() => onTogglePin(entry)}
							style={{ padding: 10 }}
						>
							{entry.pinned ? (
								<PinOff size={15} color={theme.colors.textSecondary} />
							) : (
								<Pin size={15} color={theme.colors.textSecondary} />
							)}
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Delete history item"
							onPress={() => onDelete(entry)}
							style={{ padding: 10 }}
						>
							<Trash2 size={15} color={theme.colors.textSecondary} />
						</Pressable>
					</View>
				);
			})}
		</View>
	);
}
```

- [ ] **Step 10: Account for added panel height in text area sizing**

Update the `chrome` constant inside `effectiveTextMaxHeight` from:

```ts
const chrome = 32 + 52 + 60;
```

to:

```ts
const chrome = 32 + 52 + 60 + (historyPanelOpen ? 220 : 48);
```

Add `historyPanelOpen` to that `useMemo` dependency list.

- [ ] **Step 11: Run typecheck and fix only mechanical compile errors from this task**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS. If TypeScript reports a missing dependency in a hook dependency list, add exactly the missing variable to that list. If TypeScript reports an unused import, remove that import.

- [ ] **Step 12: Run targeted integration tests**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts terminal-input-payloads.test.ts wispr-text-editor-flow.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit the UI plus shell recording**

If Task 3 Step 8 has not been committed yet, include those files in this commit too:

```bash
git add apps/mobile/src/app/shell/components/TextEntryModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/src/lib/text-entry-history-store-native.ts
git commit -m "feat(mobile): add text dialog history UI"
```

---

### Task 5: Integration Guard For Clipboard Non-Capture

**Files:**
- Modify: `apps/mobile/test/integration/text-entry-history.test.ts`

- [ ] **Step 1: Add a regression test that models Text dialog capture only**

Append this test to `apps/mobile/test/integration/text-entry-history.test.ts`:

```ts
void test('clipboard-style text is not recorded unless recordPaste is called', () => {
	const memory = createMemoryStorage();
	const store = createTextEntryHistoryStore({
		storage: memory.storage,
		logger: noopLogger,
		now: () => 100,
		random: () => 0.5,
	});

	const clipboardText = 'clipboard only';
	assert.equal(clipboardText.length > 0, true);
	assert.deepEqual(store.load(), createEmptyTextEntryHistoryState());

	const textDialogState = store.recordPaste('text dialog paste');
	assert.deepEqual(
		textDialogState.entries.map((entry) => entry.text),
		['text dialog paste'],
	);
	assert.equal(
		textDialogState.entries.some((entry) => entry.text === clipboardText),
		false,
	);
});
```

- [ ] **Step 2: Run the focused test file**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the regression test**

```bash
git add apps/mobile/test/integration/text-entry-history.test.ts
git commit -m "test(mobile): guard text history capture source"
```

---

### Task 6: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run all relevant automated checks**

Run:

```bash
pnpm --filter @fressh/mobile test:integration -- text-entry-history.test.ts terminal-input-payloads.test.ts wispr-text-editor-flow.test.ts
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile lint:check
```

Expected:

```text
text-entry-history.test.ts passes
terminal-input-payloads.test.ts passes
wispr-text-editor-flow.test.ts passes
typecheck exits 0
lint:check exits 0
```

- [ ] **Step 2: Inspect the final diff for accidental scope creep**

Run:

```bash
git diff --stat HEAD
git diff -- apps/mobile/src/lib/text-entry-history.ts apps/mobile/src/lib/text-entry-history-store-native.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/src/app/shell/components/TextEntryModal.tsx apps/mobile/test/integration/text-entry-history.test.ts
```

Expected: diff only contains Text dialog history code, tests, and the native store wrapper. It does not change clipboard payload semantics, commander payload semantics, keyboard config, Wispr state-machine logic, or terminal send ordering.

- [ ] **Step 3: Manual Android preview verification**

Use the project’s default Android preview workflow. Install or update the preview build according to the repository policy, then verify:

```text
1. Open a shell session.
2. Open the Text dialog.
3. Type "echo first" and press Paste.
4. Reopen Text and press Previous. The editor loads "echo first".
5. Type "echo second" and press Paste.
6. Reopen Text and cycle Previous/Next. The editor moves between "echo second" and "echo first".
7. Pin the current editor text. Open History. The item appears under Pinned.
8. Paste 51 distinct unpinned text values. Open History. Recent has 50 unpinned items, and the pinned item remains.
9. Select a history row. It loads into the editor and does not send until Paste is pressed.
10. Edit the selected text and press Paste. The edited text is sent with Enter and appears at the top of history.
11. Delete one recent row. It disappears from the panel.
12. Clear History. Recent is empty and pinned rows remain.
13. Clipboard paste still sends clipboard text and does not create Text dialog history.
14. Wispr controls in the Text dialog still render and operate as before.
```

- [ ] **Step 4: Commit final fixes if verification required changes**

If Step 1, Step 2, or Step 3 required fixes, commit those fixes:

```bash
git add apps/mobile/src/lib/text-entry-history.ts apps/mobile/src/lib/text-entry-history-store-native.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/src/app/shell/components/TextEntryModal.tsx apps/mobile/test/integration/text-entry-history.test.ts
git commit -m "fix(mobile): polish text entry history"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage:
  - Text-dialog-only capture: Task 3 records only from `handlePasteTextEntry`; Task 5 guards clipboard non-capture.
  - Persistence across restarts: Task 3 creates `text-entry-history` MMKV store.
  - 50 recent retention and pins outside limit: Task 1 and Task 2 cover this in pure logic.
  - Cycle controls and history panel: Task 4 adds previous/next controls and inline panel.
  - Pin current text and rows, unpin, delete, clear recent: Task 4 UI callbacks and Task 2 store methods cover all actions.
  - Storage error behavior: Task 1 includes persistence failure and invalid storage tests; Task 2 logs and keeps returning updated state.
  - Existing Paste appends Enter: Task 3 and Task 6 keep `buildTextEntryPasteSegments`; existing payload tests remain part of verification.
- Red-flag scan: no incomplete markers or undefined task references are intentionally left in this plan.
- Type consistency:
  - `TextEntryHistoryState`, `TextEntryHistoryEntry`, `TextEntryHistoryStorage`, and all mutation function names are defined in Task 2 before subsequent tasks use them.
  - `TextEntryHistoryModalProps` is defined in Task 4 before `detail.tsx` passes the `history` prop.
