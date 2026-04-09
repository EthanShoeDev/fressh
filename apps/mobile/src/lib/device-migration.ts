import * as z from 'zod';
import {
	connectionMetadataSchema,
	storedConnectionDetailsSchema,
	type StoredConnectionEntry,
} from './connection-storage';

type KeyMetadata = {
	priority: number;
	createdAtMs: number;
	label?: string;
	isDefault?: boolean;
};

const backupKeyEntrySchema = z.object({
	id: z.string().min(1),
	metadata: z.object({
		priority: z.number(),
		createdAtMs: z.int(),
		label: z.string().optional(),
		isDefault: z.boolean().optional(),
	}) satisfies z.ZodType<KeyMetadata>,
	value: z.string().min(1),
});

const backupConnectionEntrySchema = z.object({
	id: z.string().min(1),
	metadata: connectionMetadataSchema,
	value: storedConnectionDetailsSchema,
});

export const backupPayloadSchema = z.object({
	version: z.literal(1),
	createdAt: z.string().min(1),
	keys: z.array(backupKeyEntrySchema),
	connections: z.array(backupConnectionEntrySchema),
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;
export type BackupKeyEntry = z.infer<typeof backupKeyEntrySchema>;

export type PrivateKeyReplacementStorage = {
	clearAllEntries: () => Promise<void>;
	upsertEntry: (entry: BackupKeyEntry) => Promise<void>;
};

export async function createBackupPayload(params: {
	createdAt?: string;
	listKeys: () => Promise<BackupKeyEntry[]>;
	listConnections: () => Promise<StoredConnectionEntry[]>;
}): Promise<BackupPayload> {
	return {
		version: 1,
		createdAt: params.createdAt ?? new Date().toISOString(),
		keys: await params.listKeys(),
		connections: await params.listConnections(),
	};
}

export function parseBackupPayload(raw: string): BackupPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('Invalid backup format.');
	}
	const result = backupPayloadSchema.safeParse(parsed);
	if (!result.success) {
		const version = (parsed as { version?: unknown } | null)?.version;
		if (version !== 1) throw new Error('Unsupported backup version.');
		throw new Error('Invalid backup format.');
	}
	return result.data;
}

export async function replaceAllPrivateKeys(params: {
	entries: BackupKeyEntry[];
	storage: PrivateKeyReplacementStorage;
	validatePrivateKey: (value: string) => void;
}) {
	for (const entry of params.entries) {
		params.validatePrivateKey(entry.value);
	}
	await params.storage.clearAllEntries();
	for (const entry of params.entries) {
		await params.storage.upsertEntry(entry);
	}
}

export function createReplaceAllPrivateKeyEntriesHandler(params: {
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	invalidateKeysQuery: () => Promise<void>;
}) {
	return async (entries: BackupKeyEntry[]) => {
		await params.replaceAllKeys(entries);
		await params.invalidateKeysQuery();
	};
}

export async function replaceAllFromBackup(params: {
	payload: BackupPayload;
	replaceAllKeys: (entries: BackupKeyEntry[]) => Promise<void>;
	replaceAllConnections: (entries: StoredConnectionEntry[]) => Promise<void>;
}) {
	await params.replaceAllKeys(params.payload.keys);
	await params.replaceAllConnections(params.payload.connections);
	return {
		restoredKeys: params.payload.keys.length,
		restoredConnections: params.payload.connections.length,
	};
}
