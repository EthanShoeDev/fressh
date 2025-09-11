import SSHClient from '@dylankenneally/react-native-ssh-sftp';
import { queryOptions } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import * as z from 'zod';
import { queryClient } from './utils';

// Utility functions for chunking large data
function splitIntoChunks(data: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < data.length; i += chunkSize) {
		chunks.push(data.substring(i, i + chunkSize));
	}
	return chunks;
}

/**
 * Secure store does not support:
 * - Listing keys
 * - Storing more than 2048 bytes
 *
 * We can bypass both of those by using manifest entries and chunking.
 */
function makeBetterSecureStore<T extends object = object>(params: {
	storagePrefix: string;
	extraManifestFieldsSchema?: z.ZodType<T>;
}) {
	// const sizeLimit = 2048;
	const sizeLimit = 2000;
	const rootManifestVersion = 1;
	const manifestChunkVersion = 1;

	const rootManifestKey = `${params.storagePrefix}rootManifest`;
	const manifestChunkKey = (manifestChunkId: string) =>
		`${params.storagePrefix}manifestChunk_${manifestChunkId}`;
	const entryKey = (entryId: string, chunkIdx: number) =>
		`${params.storagePrefix}entry_${entryId}_chunk_${chunkIdx}`;

	const rootManifestSchema = z.looseObject({
		manifestVersion: z.number().default(rootManifestVersion),
		// We need to chunk the manifest itself
		manifestChunksIds: z.array(z.string()),
	});

	const entrySchema = z.object({
		id: z.string(),
		chunkCount: z.number().default(1),
		metadata: params.extraManifestFieldsSchema ?? z.object({}),
	});
	// type Entry = {
	// 	id: string;
	// 	chunkCount: number;
	// 	metadata: T;
	// };

	type Entry = z.infer<typeof entrySchema>;

	const manifestChunkSchema = z.object({
		manifestChunkVersion: z.number().default(manifestChunkVersion),
		entries: z.array(entrySchema),
	});

	async function getManifest() {
		const rawRootManifestString =
			await SecureStore.getItemAsync(rootManifestKey);

		console.log(
			`Root manifest for ${params.storagePrefix} is ${rawRootManifestString?.length} bytes`,
		);
		const unsafedRootManifest = rawRootManifestString
			? JSON.parse(rawRootManifestString)
			: {
					manifestVersion: rootManifestVersion,
					manifestChunksIds: [],
				};
		const rootManifest = rootManifestSchema.parse(unsafedRootManifest);
		const manifestChunks = await Promise.all(
			rootManifest.manifestChunksIds.map(async (manifestChunkId) => {
				const rawManifestChunkString = await SecureStore.getItemAsync(
					manifestChunkKey(manifestChunkId),
				);
				if (!rawManifestChunkString)
					throw new Error('Manifest chunk not found');
				console.log(
					`Manifest chunk for ${params.storagePrefix} ${manifestChunkId} is ${rawManifestChunkString?.length} bytes`,
				);
				const unsafedManifestChunk = JSON.parse(rawManifestChunkString);
				return {
					manifestChunk: manifestChunkSchema.parse(unsafedManifestChunk),
					manifestChunkId,
					manifestChunkSize: rawManifestChunkString.length,
				};
			}),
		);
		return {
			rootManifest,
			manifestChunks,
		};
	}

	async function getEntry(id: string) {
		const manifest = await getManifest();
		const manifestEntry = manifest.manifestChunks.reduce<Entry | undefined>(
			(_, mChunk) =>
				mChunk.manifestChunk.entries.find((entry) => entry.id === id),
			undefined,
		);
		if (!manifestEntry) throw new Error('Entry not found');

		const rawEntryChunks = await Promise.all(
			Array.from({ length: manifestEntry.chunkCount }, async (_, chunkIdx) => {
				const rawEntryChunk = await SecureStore.getItemAsync(
					entryKey(id, chunkIdx),
				);
				console.log(
					`Entry chunk for ${params.storagePrefix} ${id} ${chunkIdx} is ${rawEntryChunk?.length} bytes`,
				);
				return rawEntryChunk;
			}),
		);
		const entry = rawEntryChunks.join('');
		return entry;
	}

	async function listEntries() {
		const manifest = await getManifest();
		return manifest.manifestChunks.flatMap(
			(mChunk) => mChunk.manifestChunk.entries,
		);
	}

	async function deleteEntry(id: string) {
		const manifest = await getManifest();
		const manifestChunkContainingEntry = manifest.manifestChunks.find(
			(mChunk) => mChunk.manifestChunk.entries.some((entry) => entry.id === id),
		);
		if (!manifestChunkContainingEntry) throw new Error('Entry not found');

		const manifestEntry =
			manifestChunkContainingEntry.manifestChunk.entries.find(
				(entry) => entry.id === id,
			);
		if (!manifestEntry) throw new Error('Entry not found');

		const deleteEntryChunksPromise = Array.from(
			{ length: manifestEntry.chunkCount },
			async (_, chunkIdx) => {
				await SecureStore.deleteItemAsync(entryKey(id, chunkIdx));
			},
		);

		const updateManifestChunkPromise = SecureStore.setItemAsync(
			manifestChunkKey(manifestChunkContainingEntry.manifestChunkId),
			JSON.stringify({
				...manifestChunkContainingEntry,
				entries: manifestChunkContainingEntry.manifestChunk.entries.filter(
					(entry) => entry.id !== id,
				),
			}),
		);

		await Promise.all([
			...deleteEntryChunksPromise,
			updateManifestChunkPromise,
		]);
	}

	async function upsertEntry(params: {
		id: string;
		metadata: T;
		value: string;
	}) {
		await deleteEntry(params.id).catch(() => {
			console.log(`Entry ${params.id} not found, creating new one`);
		});

		const valueChunks = splitIntoChunks(params.value, sizeLimit);
		const newManifestEntry = entrySchema.parse({
			id: params.id,
			chunkCount: valueChunks.length,
			...params.metadata,
		});
		const newManifestEntrySize = JSON.stringify(newManifestEntry).length;
		if (newManifestEntrySize > sizeLimit / 2)
			throw new Error('Manifest entry size is too large');
		const manifest = await getManifest();

		const existingManifestChunkWithRoom = manifest.manifestChunks.find(
			(mChunk) => sizeLimit > mChunk.manifestChunkSize + newManifestEntrySize,
		);
		const manifestChunkWithRoom =
			existingManifestChunkWithRoom ??
			(await (async () => {
				const newManifestChunk = {
					manifestChunk: {
						entries: [],
						manifestChunkVersion: manifestChunkVersion,
					},
					manifestChunkId: crypto.randomUUID(),
					manifestChunkSize: 0,
				} satisfies NonNullable<(typeof manifest.manifestChunks)[number]>;
				await SecureStore.setItemAsync(
					rootManifestKey,
					JSON.stringify(manifest.rootManifest),
				);
				return newManifestChunk;
			})());

		manifestChunkWithRoom.manifestChunk.entries.push(newManifestEntry);
		await Promise.all([
			SecureStore.setItemAsync(
				manifestChunkKey(manifestChunkWithRoom.manifestChunkId),
				JSON.stringify(manifestChunkWithRoom.manifestChunk),
			),
			...valueChunks.map((vChunk, chunkIdx) =>
				SecureStore.setItemAsync(
					entryKey(newManifestEntry.id, chunkIdx),
					vChunk,
				),
			),
		]);
	}

	return {
		getManifest,
		getEntry,
		listEntries,
		upsertEntry,
		deleteEntry,
	};
}

const betterKeyStorage = makeBetterSecureStore({
	storagePrefix: 'privateKey_',
	extraManifestFieldsSchema: z.object({
		priority: z.number(),
		createdAtMs: z.int(),
	}),
});

const betterConnectionStorage = makeBetterSecureStore({
	storagePrefix: 'connection_',
	extraManifestFieldsSchema: z.object({
		priority: z.number(),
		createdAtMs: z.int(),
		modifiedAtMs: z.int(),
	}),
});

async function savePrivateKey(params: {
	keyId: string;
	privateKey: string;
	priority: number;
}) {
	await betterKeyStorage.upsertEntry({
		id: params.keyId,
		metadata: {
			priority: params.priority,
			createdAtMs: Date.now(),
		},
		value: params.privateKey,
	});
	await queryClient.invalidateQueries({ queryKey: [keyQueryKey] });
}

async function getPrivateKey(keyId: string) {
	return await betterKeyStorage.getEntry(keyId);
}

async function deletePrivateKey(keyId: string) {
	await betterKeyStorage.deleteEntry(keyId);
	await queryClient.invalidateQueries({ queryKey: [keyQueryKey] });
}

export const connectionDetailsSchema = z.object({
	host: z.string().min(1),
	port: z.number().min(1),
	username: z.string().min(1),
	security: z.discriminatedUnion('type', [
		z.object({
			type: z.literal('password'),
			password: z.string().min(1),
		}),
		z.object({
			type: z.literal('key'),
			keyId: z.string().min(1),
		}),
	]),
});

export type ConnectionDetails = z.infer<typeof connectionDetailsSchema>;

async function upsertConnection(params: {
	id: string;
	details: ConnectionDetails;
	priority: number;
}) {
	await betterConnectionStorage.upsertEntry({
		id: params.id,
		metadata: {
			priority: params.priority,
			createdAtMs: Date.now(),
			modifiedAtMs: Date.now(),
		},
		value: JSON.stringify(params.details),
	});
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
	return params.details;
}

async function deleteConnection(id: string) {
	await betterConnectionStorage.deleteEntry(id);
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
}

async function getConnection(id: string) {
	const connDetailsString = await betterConnectionStorage.getEntry(id);
	return connectionDetailsSchema.parse(JSON.parse(connDetailsString));
}

const connectionQueryKey = 'connections';

const listConnectionsQueryOptions = queryOptions({
	queryKey: [connectionQueryKey],
	queryFn: async () => {
		const connManifests = await betterConnectionStorage.listEntries();
		const results = await Promise.all(
			connManifests.map(async (connManifest) => {
				const details = await getConnection(connManifest.id);
				return {
					details,
					id: connManifest.id,
				};
			}),
		);
		return results;
	},
});

const getConnectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: [connectionQueryKey, id],
		queryFn: () => getConnection(id),
	});

const keyQueryKey = 'keys';

const listKeysQueryOptions = queryOptions({
	queryKey: [keyQueryKey],
	queryFn: async () => await betterKeyStorage.listEntries(),
});

// https://github.com/dylankenneally/react-native-ssh-sftp/blob/ea55436d8d40378a8f9dabb95b463739ffb219fa/android/src/main/java/me/keeex/rnssh/RNSshClientModule.java#L101-L119
export type SshPrivateKeyType = 'dsa' | 'rsa' | 'ecdsa' | 'ed25519' | 'ed448';
async function generateKeyPair(params: {
	type: SshPrivateKeyType;
	passphrase?: string;
	keySize?: number;
	comment?: string;
}) {
	const keyPair = await SSHClient.generateKeyPair(
		params.type,
		params.passphrase ?? '',
		params.keySize,
		params.comment ?? '',
	);
	return keyPair;
}

export const secretsManager = {
	keys: {
		utils: {
			listPrivateKeys: () => betterKeyStorage.listEntries(),
			savePrivateKey,
			getPrivateKey,
			deletePrivateKey,
			generateKeyPair,
		},
		query: {
			list: listKeysQueryOptions,
		},
	},
	connections: {
		utils: {
			upsertConnection,
			deleteConnection,
		},
		query: {
			list: listConnectionsQueryOptions,
			get: getConnectionQueryOptions,
		},
	},
};
