export const TEXT_ENTRY_HISTORY_STORAGE_KEY = 'textEntryHistory.state.v1';
export const TEXT_ENTRY_HISTORY_MAX_RECENT = 50;

const textEntryHistoryVersion = 1;

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
	warn: (message: string, meta?: unknown) => void;
};

type MutationOptionsWithId = {
	id: string;
	nowMs: number;
};

type MutationOptions = {
	nowMs: number;
};

type ParseResult = {
	state: TextEntryHistoryState;
	resetRequired: boolean;
};

type StoreDependencies = {
	storage: TextEntryHistoryStorage;
	logger?: TextEntryHistoryLogger;
	now?: () => number;
	random?: () => number;
};

type StoreReadState = {
	state: TextEntryHistoryState;
	writable: boolean;
};

const noopLogger: TextEntryHistoryLogger = {
	warn: () => {},
};

const stateKeys = ['entries', 'version'] as const;
const entryKeys = [
	'createdAtMs',
	'id',
	'lastUsedAtMs',
	'pinned',
	'text',
] as const;

export function createEmptyTextEntryHistoryState(): TextEntryHistoryState {
	return {
		version: textEntryHistoryVersion,
		entries: [],
	};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	expectedKeys: readonly string[],
) {
	const keys = Object.keys(value);
	return (
		keys.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(value, key))
	);
}

function isValidEntry(value: unknown): value is TextEntryHistoryEntry {
	if (!isPlainRecord(value)) return false;
	return (
		hasExactKeys(value, entryKeys) &&
		typeof value.id === 'string' &&
		typeof value.text === 'string' &&
		typeof value.createdAtMs === 'number' &&
		Number.isFinite(value.createdAtMs) &&
		typeof value.lastUsedAtMs === 'number' &&
		Number.isFinite(value.lastUsedAtMs) &&
		typeof value.pinned === 'boolean'
	);
}

function hasUniquePersistedEntryKeys(entries: TextEntryHistoryEntry[]) {
	const ids = new Set<string>();
	const texts = new Set<string>();
	for (const entry of entries) {
		if (ids.has(entry.id) || texts.has(entry.text)) return false;
		ids.add(entry.id);
		texts.add(entry.text);
	}
	return true;
}

function compareEntries(a: TextEntryHistoryEntry, b: TextEntryHistoryEntry) {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	if (a.lastUsedAtMs !== b.lastUsedAtMs) {
		return b.lastUsedAtMs - a.lastUsedAtMs;
	}
	if (a.createdAtMs !== b.createdAtMs) {
		return b.createdAtMs - a.createdAtMs;
	}
	return a.id.localeCompare(b.id);
}

function normalizeEntries(
	entries: TextEntryHistoryEntry[],
): TextEntryHistoryEntry[] {
	const sorted = [...entries].sort(compareEntries);
	const pinned = sorted.filter((entry) => entry.pinned);
	const recent = sorted
		.filter((entry) => !entry.pinned)
		.slice(0, TEXT_ENTRY_HISTORY_MAX_RECENT);
	return [...pinned, ...recent];
}

function withEntries(entries: TextEntryHistoryEntry[]): TextEntryHistoryState {
	return {
		version: textEntryHistoryVersion,
		entries: normalizeEntries(entries),
	};
}

function toPersistedEntry(entry: TextEntryHistoryEntry): TextEntryHistoryEntry {
	return {
		id: entry.id,
		text: entry.text,
		createdAtMs: entry.createdAtMs,
		lastUsedAtMs: entry.lastUsedAtMs,
		pinned: entry.pinned,
	};
}

function toPersistedState(state: TextEntryHistoryState): TextEntryHistoryState {
	return {
		version: textEntryHistoryVersion,
		entries: normalizeEntries(state.entries).map(toPersistedEntry),
	};
}

function deriveUniqueEntryId(
	entries: TextEntryHistoryEntry[],
	requestedId: string,
) {
	const existingIds = new Set(entries.map((entry) => entry.id));
	if (!existingIds.has(requestedId)) return requestedId;

	for (let suffix = 1; ; suffix += 1) {
		const id = `${requestedId}-${suffix}`;
		if (!existingIds.has(id)) return id;
	}
}

export function parseTextEntryHistoryState(
	raw: string | undefined,
): ParseResult {
	if (raw === undefined) {
		return {
			state: createEmptyTextEntryHistoryState(),
			resetRequired: false,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			state: createEmptyTextEntryHistoryState(),
			resetRequired: true,
		};
	}

	if (
		!isPlainRecord(parsed) ||
		!hasExactKeys(parsed, stateKeys) ||
		parsed.version !== textEntryHistoryVersion ||
		!Array.isArray(parsed.entries) ||
		!parsed.entries.every(isValidEntry) ||
		!hasUniquePersistedEntryKeys(parsed.entries)
	) {
		return {
			state: createEmptyTextEntryHistoryState(),
			resetRequired: true,
		};
	}

	return {
		state: withEntries(parsed.entries),
		resetRequired: false,
	};
}

export function serializeTextEntryHistoryState(
	state: TextEntryHistoryState,
): string {
	return JSON.stringify(toPersistedState(state));
}

export function recordTextEntryPaste(
	state: TextEntryHistoryState,
	text: string,
	{ id, nowMs }: MutationOptionsWithId,
): TextEntryHistoryState {
	if (text.length === 0) return state;

	const existing = state.entries.find((entry) => entry.text === text);
	if (existing) {
		return withEntries(
			state.entries.map((entry) =>
				entry.id === existing.id
					? {
							...entry,
							lastUsedAtMs: nowMs,
						}
					: entry,
			),
		);
	}

	return withEntries([
		{
			id: deriveUniqueEntryId(state.entries, id),
			text,
			createdAtMs: nowMs,
			lastUsedAtMs: nowMs,
			pinned: false,
		},
		...state.entries,
	]);
}

export function pinTextEntryHistoryText(
	state: TextEntryHistoryState,
	text: string,
	{ id, nowMs }: MutationOptionsWithId,
): TextEntryHistoryState {
	if (text.length === 0) return state;

	const existing = state.entries.find((entry) => entry.text === text);
	if (existing) {
		return withEntries(
			state.entries.map((entry) =>
				entry.id === existing.id
					? {
							...entry,
							lastUsedAtMs: nowMs,
							pinned: true,
						}
					: entry,
			),
		);
	}

	return withEntries([
		{
			id: deriveUniqueEntryId(state.entries, id),
			text,
			createdAtMs: nowMs,
			lastUsedAtMs: nowMs,
			pinned: true,
		},
		...state.entries,
	]);
}

export function pinTextEntryHistoryEntry(
	state: TextEntryHistoryState,
	id: string,
	{ nowMs }: MutationOptions,
): TextEntryHistoryState {
	return withEntries(
		state.entries.map((entry) =>
			entry.id === id
				? {
						...entry,
						lastUsedAtMs: nowMs,
						pinned: true,
					}
				: entry,
		),
	);
}

export function unpinTextEntryHistoryEntry(
	state: TextEntryHistoryState,
	id: string,
	{ nowMs }: MutationOptions,
): TextEntryHistoryState {
	return withEntries(
		state.entries.map((entry) =>
			entry.id === id
				? {
						...entry,
						lastUsedAtMs: nowMs,
						pinned: false,
					}
				: entry,
		),
	);
}

export function deleteTextEntryHistoryEntry(
	state: TextEntryHistoryState,
	id: string,
): TextEntryHistoryState {
	return withEntries(state.entries.filter((entry) => entry.id !== id));
}

export function clearRecentTextEntryHistory(
	state: TextEntryHistoryState,
): TextEntryHistoryState {
	return withEntries(state.entries.filter((entry) => entry.pinned));
}

export function getTextEntryHistorySections(
	state: TextEntryHistoryState,
): TextEntryHistorySections {
	const entries = normalizeEntries(state.entries);
	return {
		pinned: entries.filter((entry) => entry.pinned),
		recent: entries.filter((entry) => !entry.pinned),
	};
}

export function getTextEntryHistoryCycleEntries(
	state: TextEntryHistoryState,
): TextEntryHistoryEntry[] {
	return normalizeEntries(state.entries);
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
	logger = noopLogger,
	now = () => Date.now(),
	random = () => Math.random(),
}: StoreDependencies) {
	function readState(): StoreReadState {
		let raw: string | undefined;
		try {
			raw = storage.getString(TEXT_ENTRY_HISTORY_STORAGE_KEY);
		} catch (error) {
			logger.warn('Failed to load text entry history state', error);
			return {
				state: createEmptyTextEntryHistoryState(),
				writable: false,
			};
		}

		const result = parseTextEntryHistoryState(raw);
		if (result.resetRequired) {
			try {
				storage.delete(TEXT_ENTRY_HISTORY_STORAGE_KEY);
			} catch (error) {
				logger.warn('Failed to reset invalid text entry history state', error);
			}
			logger.warn('Reset invalid text entry history state');
		}
		return {
			state: result.state,
			writable: true,
		};
	}

	function load() {
		const result = readState();
		return result.state;
	}

	function persist(state: TextEntryHistoryState, writable: boolean) {
		if (!writable) return state;
		try {
			if (state.entries.length === 0) {
				storage.delete(TEXT_ENTRY_HISTORY_STORAGE_KEY);
			} else {
				storage.set(
					TEXT_ENTRY_HISTORY_STORAGE_KEY,
					serializeTextEntryHistoryState(state),
				);
			}
		} catch (error) {
			logger.warn('Failed to persist text entry history state', error);
		}
		return state;
	}

	function createUniqueId(state: TextEntryHistoryState, nowMs: number) {
		const existingIds = new Set(state.entries.map((entry) => entry.id));
		for (let attempt = 0; ; attempt += 1) {
			const id = createTextEntryHistoryId(nowMs + attempt, random);
			if (!existingIds.has(id)) return id;
		}
	}

	return {
		load,
		recordPaste(text: string) {
			const read = readState();
			const nowMs = now();
			return persist(
				recordTextEntryPaste(read.state, text, {
					id: createUniqueId(read.state, nowMs),
					nowMs,
				}),
				read.writable,
			);
		},
		pinText(text: string) {
			const read = readState();
			const nowMs = now();
			return persist(
				pinTextEntryHistoryText(read.state, text, {
					id: createUniqueId(read.state, nowMs),
					nowMs,
				}),
				read.writable,
			);
		},
		pinEntry(id: string) {
			const read = readState();
			return persist(
				pinTextEntryHistoryEntry(read.state, id, { nowMs: now() }),
				read.writable,
			);
		},
		unpinEntry(id: string) {
			const read = readState();
			return persist(
				unpinTextEntryHistoryEntry(read.state, id, { nowMs: now() }),
				read.writable,
			);
		},
		deleteEntry(id: string) {
			const read = readState();
			return persist(
				deleteTextEntryHistoryEntry(read.state, id),
				read.writable,
			);
		},
		clearRecent() {
			const read = readState();
			return persist(clearRecentTextEntryHistory(read.state), read.writable);
		},
	};
}
