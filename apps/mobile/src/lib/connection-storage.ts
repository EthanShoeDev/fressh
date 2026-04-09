import * as z from 'zod';
import { type ChunkedStoreEntry } from './chunked-storage';
import { getStoredConnectionId } from './connection-utils';

type LoggerLike = {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
};

export const connectionMetadataSchema = z.object({
	priority: z.number(),
	createdAtMs: z.int(),
	modifiedAtMs: z.int(),
	label: z.string().optional(),
});

export const storedConnectionDetailsSchema = z.object({
	host: z.string().min(1),
	port: z.number().min(1),
	username: z.string().min(1),
	security: z.object({
		type: z.literal('key'),
		keyId: z.string().min(1),
	}),
	useTmux: z.boolean().optional(),
	tmuxSessionName: z.string().optional(),
	autoConnect: z.boolean().optional(),
});

export const connectionDetailsSchema = storedConnectionDetailsSchema
	.extend({
		useTmux: z.boolean(),
		tmuxSessionName: z.string(),
		autoConnect: z.boolean(),
	})
	.superRefine((value, ctx) => {
		if (!value.useTmux) return;
		if (value.tmuxSessionName.trim().length > 0) return;
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Tmux session name is required when tmux is enabled.',
			path: ['tmuxSessionName'],
		});
	});

export type ConnectionMetadata = z.infer<typeof connectionMetadataSchema>;
export type InputConnectionDetails = z.infer<typeof connectionDetailsSchema>;
export type StoredConnectionDetails = z.infer<
	typeof storedConnectionDetailsSchema
>;
export type StoredConnectionEntry = {
	id: string;
	metadata: ConnectionMetadata;
	value: StoredConnectionDetails;
};

type StringStorage = {
	getString: (key: string) => string | undefined;
	set: (key: string, value: string) => void;
	delete: (key: string) => void;
};

type LegacyConnectionStorage = {
	listEntries: () => Promise<ChunkedStoreEntry<ConnectionMetadata>[]>;
	getEntry: (id: string) => Promise<{
		manifestEntry: ChunkedStoreEntry<ConnectionMetadata>;
		value: StoredConnectionDetails;
	}>;
	clearAllEntries: () => Promise<void>;
};

const connectionsStateKey = 'connections.entries.v1';
const connectionsMigrationKey = 'connections.migrated-from-secure-store.v1';

const storedConnectionEntrySchema = z.object({
	id: z.string(),
	metadata: connectionMetadataSchema,
	value: storedConnectionDetailsSchema,
});

const storedConnectionEntriesByIdSchema = z.record(
	z.string(),
	storedConnectionEntrySchema,
);

export function normalizeStoredConnectionDetails(
	details: StoredConnectionDetails,
): InputConnectionDetails {
	return {
		...details,
		useTmux: details.useTmux ?? true,
		tmuxSessionName: details.tmuxSessionName?.trim().length
			? details.tmuxSessionName.trim()
			: 'main',
		autoConnect: details.autoConnect ?? false,
	};
}

function pickPreferredConnectionEntry(
	currentEntry: StoredConnectionEntry | undefined,
	candidateEntry: StoredConnectionEntry,
) {
	if (!currentEntry) return candidateEntry;
	if (
		candidateEntry.metadata.modifiedAtMs > currentEntry.metadata.modifiedAtMs
	) {
		return candidateEntry;
	}
	return currentEntry;
}

export function createConnectionStorage(params: {
	storage: StringStorage;
	legacyStorage: LegacyConnectionStorage;
	logger: LoggerLike;
	now?: () => number;
}) {
	const now = params.now ?? (() => Date.now());
	let migrationPromise: Promise<void> | null = null;

	function readEntriesById() {
		const rawEntries = params.storage.getString(connectionsStateKey);
		if (!rawEntries) return {};

		try {
			const unsafeEntries: unknown = JSON.parse(rawEntries);
			return storedConnectionEntriesByIdSchema.parse(unsafeEntries);
		} catch (error) {
			// If MMKV contains invalid data, reset it and rebuild from legacy data.
			params.logger.warn('Resetting invalid MMKV connection store', {
				error: String(error),
			});
			params.storage.delete(connectionsStateKey);
			params.storage.delete(connectionsMigrationKey);
			return {};
		}
	}

	function writeEntriesById(entriesById: Record<string, StoredConnectionEntry>) {
		if (Object.keys(entriesById).length === 0) {
			params.storage.delete(connectionsStateKey);
			return;
		}
		params.storage.set(connectionsStateKey, JSON.stringify(entriesById));
	}

	async function migrateLegacyConnections() {
		const mergedEntries = new Map<string, StoredConnectionEntry>(
			Object.values(readEntriesById()).map((entry) => [entry.id, entry]),
		);

		let legacyEntries: ChunkedStoreEntry<ConnectionMetadata>[] = [];
		try {
			legacyEntries = await params.legacyStorage.listEntries();
		} catch (error) {
			// A manifest read failure is not safe to treat as an empty legacy store.
			// Keep SecureStore untouched and retry migration on a later launch.
			params.logger.warn('Deferring legacy connection migration after read failure', {
				error: String(error),
			});
			return;
		}

		for (const legacyEntry of legacyEntries) {
			try {
				const loadedEntry = await params.legacyStorage.getEntry(legacyEntry.id);
				const normalizedEntry = storedConnectionEntrySchema.parse({
					id: loadedEntry.manifestEntry.id,
					metadata: loadedEntry.manifestEntry.metadata,
					value: normalizeStoredConnectionDetails(loadedEntry.value),
				});
				mergedEntries.set(
					normalizedEntry.id,
					pickPreferredConnectionEntry(
						mergedEntries.get(normalizedEntry.id),
						normalizedEntry,
					),
				);
			} catch (error) {
				params.logger.warn('Skipping unreadable legacy connection entry', {
					id: legacyEntry.id,
					error: String(error),
				});
			}
		}

		writeEntriesById(Object.fromEntries(mergedEntries.entries()));
		try {
			await params.legacyStorage.clearAllEntries();
		} catch (error) {
			params.logger.warn(
				'Failed to clear legacy SecureStore connection data after migration',
				{
					error: String(error),
				},
			);
		}
		params.storage.set(connectionsMigrationKey, 'done');
	}

	async function ensureReady() {
		if (params.storage.getString(connectionsMigrationKey) === 'done') return;
		migrationPromise ??= migrateLegacyConnections().finally(() => {
			migrationPromise = null;
		});
		await migrationPromise;
	}

	async function listEntriesWithValues() {
		await ensureReady();
		return Object.values(readEntriesById());
	}

	async function getEntry(id: string) {
		await ensureReady();
		const entry = readEntriesById()[id];
		if (!entry) throw new Error('Entry not found');
		return entry;
	}

	async function upsertConnection(params_: {
		details: StoredConnectionDetails;
		priority: number;
		label?: string;
	}) {
		await ensureReady();
		const normalizedDetails = normalizeStoredConnectionDetails(params_.details);
		const id = getStoredConnectionId(params_.details);
		const entriesById = readEntriesById();
		const existingEntry = entriesById[id];
		const createdAtMs = existingEntry?.metadata.createdAtMs ?? now();
		entriesById[id] = {
			id,
			metadata: {
				priority: params_.priority,
				createdAtMs,
				modifiedAtMs: now(),
				label: params_.label ?? existingEntry?.metadata.label,
			},
			value: normalizedDetails,
		};
		writeEntriesById(entriesById);
		return normalizedDetails;
	}

	async function deleteConnection(id: string) {
		await ensureReady();
		const entriesById = readEntriesById();
		if (!(id in entriesById)) throw new Error('Entry not found');
		delete entriesById[id];
		writeEntriesById(entriesById);
	}

	async function replaceAllEntries(entries: StoredConnectionEntry[]) {
		await ensureReady();
		writeEntriesById(
			Object.fromEntries(entries.map((entry) => [entry.id, entry])),
		);
		await params.legacyStorage.clearAllEntries();
		params.storage.set(connectionsMigrationKey, 'done');
	}

	return {
		ensureReady,
		listEntriesWithValues,
		getEntry,
		upsertConnection,
		deleteConnection,
		replaceAllEntries,
	};
}
