import { RnRussh } from '@fressh/react-native-uniffi-russh';
import { queryOptions } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as z from 'zod';
import { queryClient, type StrictOmit } from './utils';

const shouldLog = false as boolean;
const log = (...args: Parameters<typeof console.log>) => {
	if (shouldLog) {
		console.log(...args);
	}
};

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
function makeBetterSecureStore<
	T extends object = object,
	Value = string,
>(storeParams: {
	storagePrefix: string;
	parseValue: (value: string) => Value;
	extraManifestFieldsSchema?: z.ZodType<T>;
}) {
	// const sizeLimit = 2048;
	const sizeLimit = 2000;
	const rootManifestVersion = 1;
	const manifestChunkVersion = 1;

	const rootManifestKey = [storeParams.storagePrefix, 'rootManifest'].join('-');
	const manifestChunkKey = (manifestChunkId: string) =>
		[storeParams.storagePrefix, 'manifestChunk', manifestChunkId].join('-');
	const entryKey = (entryId: string, chunkIdx: number) =>
		[storeParams.storagePrefix, 'entry', entryId, 'chunk', chunkIdx].join('-');

	const rootManifestSchema = z.looseObject({
		manifestVersion: z.number().default(rootManifestVersion),
		// We need to chunk the manifest itself
		manifestChunksIds: z.array(z.string()),
	});

	const entrySchema = z.object({
		id: z.string(),
		chunkCount: z.number().default(1),
		metadata: storeParams.extraManifestFieldsSchema ?? z.object({}),
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

		log('DEBUG rawRootManifestString', rawRootManifestString);

		log(
			`Root manifest for ${rootManifestKey} is ${rawRootManifestString?.length ?? 0} bytes`,
		);
		const unsafedRootManifest: unknown = rawRootManifestString
			? JSON.parse(rawRootManifestString)
			: {
					manifestVersion: rootManifestVersion,
					manifestChunksIds: [],
				};
		const rootManifest = rootManifestSchema.parse(unsafedRootManifest);
		const manifestChunks = await Promise.all(
			rootManifest.manifestChunksIds.map(async (manifestChunkId) => {
				const manifestChunkKeyString = manifestChunkKey(manifestChunkId);
				const rawManifestChunkString = await SecureStore.getItemAsync(
					manifestChunkKeyString,
				);
				if (!rawManifestChunkString)
					throw new Error('Manifest chunk not found');
				log(
					`Manifest chunk for ${manifestChunkKeyString} is ${rawManifestChunkString.length} bytes`,
				);
				const unsafedManifestChunk: unknown = JSON.parse(
					rawManifestChunkString,
				);
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

	async function _getEntryValueFromManifestEntry(
		manifestEntry: Entry,
	): Promise<Value> {
		const rawEntryChunks = await Promise.all(
			Array.from({ length: manifestEntry.chunkCount }, async (_, chunkIdx) => {
				const entryKeyString = entryKey(manifestEntry.id, chunkIdx);
				const rawEntryChunk = await SecureStore.getItemAsync(entryKeyString);
				log(
					`Entry chunk for ${entryKeyString} is ${rawEntryChunk?.length} bytes`,
				);
				if (!rawEntryChunk) throw new Error('Entry chunk not found');
				return rawEntryChunk;
			}),
		);
		const entry = rawEntryChunks.join('');
		return storeParams.parseValue(entry);
	}

	async function getEntry(id: string) {
		const manifest = await getManifest();
		const manifestEntry = manifest.manifestChunks.reduce<Entry | undefined>(
			(_, mChunk) =>
				mChunk.manifestChunk.entries.find((entry) => entry.id === id),
			undefined,
		);
		if (!manifestEntry) throw new Error('Entry not found');

		return {
			value: await _getEntryValueFromManifestEntry(manifestEntry),
			manifestEntry,
		};
	}

	async function listEntries() {
		const manifest = await getManifest();
		const manifestEntries = manifest.manifestChunks.flatMap(
			(mChunk) => mChunk.manifestChunk.entries,
		);
		return manifestEntries;
	}

	async function listEntriesWithValues(): Promise<
		(Entry & { value: Value })[]
	> {
		const manifestEntries = await listEntries();
		return await Promise.all(
			manifestEntries.map(async (entry) => {
				return {
					...entry,
					value: await _getEntryValueFromManifestEntry(entry),
				} as Entry & { value: Value };
			}),
		);
	}

	async function deleteEntry(id: string) {
		let manifest = await getManifest();
		const manifestChunkContainingEntry = manifest.manifestChunks.find(
			(mChunk) => mChunk.manifestChunk.entries.some((entry) => entry.id === id),
		);
		if (!manifestChunkContainingEntry) throw new Error('Entry not found');

		const manifestEntry =
			manifestChunkContainingEntry.manifestChunk.entries.find(
				(entry) => entry.id === id,
			);
		if (!manifestEntry) throw new Error('Entry not found');

		await Promise.all([
			...Array.from(
				{ length: manifestEntry.chunkCount },
				async (_, chunkIdx) => {
					await SecureStore.deleteItemAsync(entryKey(id, chunkIdx));
				},
			),
			SecureStore.setItemAsync(
				manifestChunkKey(manifestChunkContainingEntry.manifestChunkId),
				JSON.stringify({
					...manifestChunkContainingEntry.manifestChunk,
					entries: manifestChunkContainingEntry.manifestChunk.entries.filter(
						(entry) => entry.id !== id,
					),
				}),
			),
		]);

		manifest = await getManifest();

		// check for empty manifest chunks
		const emptyManifestChunks = manifest.manifestChunks.filter(
			(mChunk) => mChunk.manifestChunk.entries.length === 0,
		);
		if (emptyManifestChunks.length > 0) {
			log('DEBUG: removing empty manifest chunks', emptyManifestChunks.length);
			manifest.rootManifest.manifestChunksIds =
				manifest.rootManifest.manifestChunksIds.filter(
					(mChunkId) =>
						!emptyManifestChunks.some(
							(mChunk) => mChunk.manifestChunkId === mChunkId,
						),
				);
			await Promise.all([
				...emptyManifestChunks.map(async (mChunk) => {
					await SecureStore.deleteItemAsync(
						manifestChunkKey(mChunk.manifestChunkId),
					);
				}),
				SecureStore.setItemAsync(
					rootManifestKey,
					JSON.stringify(manifest.rootManifest),
				),
			]);
		}
	}

	async function upsertEntry(params: {
		id: string;
		metadata: T;
		value: string;
	}) {
		await deleteEntry(params.id).catch(() => {
			log(`Entry ${params.id} not found, creating new one`);
		});

		const valueChunks = splitIntoChunks(params.value, sizeLimit);
		const newManifestEntry = entrySchema.parse({
			id: params.id,
			chunkCount: valueChunks.length,
			metadata: params.metadata,
		} satisfies Entry);
		const newManifestEntrySize = JSON.stringify(newManifestEntry).length;
		if (newManifestEntrySize > sizeLimit / 2)
			throw new Error('Manifest entry size is too large');
		const manifest = await getManifest();

		const existingManifestChunkWithRoom = manifest.manifestChunks.find(
			(mChunk) => sizeLimit > mChunk.manifestChunkSize + newManifestEntrySize,
		);
		log('DEBUG existingManifestChunkWithRoom', existingManifestChunkWithRoom);
		const manifestChunkWithRoom =
			existingManifestChunkWithRoom ??
			(await (async () => {
				const newManifestChunk = {
					manifestChunk: {
						entries: [],
						manifestChunkVersion: manifestChunkVersion,
					},
					manifestChunkId: Crypto.randomUUID(),
					manifestChunkSize: 0,
				} satisfies NonNullable<(typeof manifest.manifestChunks)[number]>;
				log(`Adding new manifest chunk ${newManifestChunk.manifestChunkId}`);
				manifest.rootManifest.manifestChunksIds.push(
					newManifestChunk.manifestChunkId,
				);
				await SecureStore.setItemAsync(
					rootManifestKey,
					JSON.stringify(manifest.rootManifest),
				);
				log('DEBUG: newRootManifest', manifest.rootManifest);
				return newManifestChunk;
			})());

		manifestChunkWithRoom.manifestChunk.entries.push(newManifestEntry);
		const manifestChunkKeyString = manifestChunkKey(
			manifestChunkWithRoom.manifestChunkId,
		);
		await Promise.all([
			SecureStore.setItemAsync(
				manifestChunkKeyString,
				JSON.stringify(manifestChunkWithRoom.manifestChunk),
			).then(() => {
				log(
					`Set manifest chunk for ${manifestChunkKeyString} to ${JSON.stringify(manifestChunkWithRoom.manifestChunk).length} bytes`,
				);
			}),
			...valueChunks.map(async (vChunk, chunkIdx) => {
				const entryKeyString = entryKey(newManifestEntry.id, chunkIdx);
				console.log('DEBUG: setting entry chunk', entryKeyString);
				await SecureStore.setItemAsync(entryKeyString, vChunk);
				log(
					`Set entry chunk for ${entryKeyString} ${chunkIdx} to ${vChunk.length} bytes`,
				);
			}),
		]);
	}

	return {
		getManifest,
		getEntry,
		listEntries,
		listEntriesWithValues,
		upsertEntry,
		deleteEntry,
	};
}

const keyMetadataSchema = z.object({
	priority: z.number(),
	createdAtMs: z.int(),
	// Optional display name for the key
	label: z.string().optional(),
	// Optional default flag
	isDefault: z.boolean().optional(),
});
export type KeyMetadata = z.infer<typeof keyMetadataSchema>;

const betterKeyStorage = makeBetterSecureStore<KeyMetadata>({
	storagePrefix: 'privateKey',
	extraManifestFieldsSchema: keyMetadataSchema,
	parseValue: (value) => value,
});

async function upsertPrivateKey(params: {
	keyId?: string;
	metadata: StrictOmit<KeyMetadata, 'createdAtMs'>;
	value: string;
}) {
	const validKey = RnRussh.validatePrivateKey(params.value);
	if (!validKey) throw new Error('Invalid private key');
	const keyId = params.keyId ?? `key_${Crypto.randomUUID()}`;
	log(`${params.keyId ? 'Upserting' : 'Creating'} private key ${keyId}`);
	// Preserve createdAtMs if the entry already exists
	const existing = await betterKeyStorage
		.getEntry(keyId)
		.catch(() => undefined);
	const createdAtMs =
		existing?.manifestEntry.metadata.createdAtMs ?? Date.now();

	await betterKeyStorage.upsertEntry({
		id: keyId,
		metadata: {
			...params.metadata,
			createdAtMs,
		},
		value: params.value,
	});
	log('DEBUG: invalidating key query');
	await queryClient.invalidateQueries({ queryKey: [keyQueryKey] });
}

async function deletePrivateKey(keyId: string) {
	await betterKeyStorage.deleteEntry(keyId);
	await queryClient.invalidateQueries({ queryKey: [keyQueryKey] });
}

const keyQueryKey = 'keys';

const listKeysQueryOptions = queryOptions({
	queryKey: [keyQueryKey],
	queryFn: async () => {
		const results = await betterKeyStorage.listEntriesWithValues();
		log(`Listed ${results.length} private keys`);
		return results;
	},
});

const getKeyQueryOptions = (keyId: string) =>
	queryOptions({
		queryKey: [keyQueryKey, keyId],
		queryFn: () => betterKeyStorage.getEntry(keyId),
	});

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

const betterConnectionStorage = makeBetterSecureStore({
	storagePrefix: 'connection',
	extraManifestFieldsSchema: z.object({
		priority: z.number(),
		createdAtMs: z.int(),
		modifiedAtMs: z.int(),
		label: z.string().optional(),
	}),
	parseValue: (value) => connectionDetailsSchema.parse(JSON.parse(value)),
});

export type InputConnectionDetails = z.infer<typeof connectionDetailsSchema>;

async function upsertConnection(params: {
	details: InputConnectionDetails;
	priority: number;
	label?: string;
}) {
	const id =
		`${params.details.username}-${params.details.host}-${params.details.port}`.replaceAll(
			'.',
			'_',
		);
	await betterConnectionStorage.upsertEntry({
		id,
		metadata: {
			priority: params.priority,
			modifiedAtMs: Date.now(),
			createdAtMs: Date.now(),
			label: params.label,
		},
		value: JSON.stringify(params.details),
	});
	log('DEBUG: invalidating connection query');
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
	return params.details;
}

async function deleteConnection(id: string) {
	await betterConnectionStorage.deleteEntry(id);
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
}

const connectionQueryKey = 'connections';

const listConnectionsQueryOptions = queryOptions({
	queryKey: [connectionQueryKey],
	queryFn: () => betterConnectionStorage.listEntriesWithValues(),
});

const getConnectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: [connectionQueryKey, id],
		queryFn: () => betterConnectionStorage.getEntry(id),
	});

export const secretsManager = {
	keys: {
		utils: {
			upsertPrivateKey,
			deletePrivateKey,
			listEntriesWithValues: betterKeyStorage.listEntriesWithValues,
			getPrivateKey: (keyId: string) => betterKeyStorage.getEntry(keyId),
		},
		query: {
			list: listKeysQueryOptions,
			get: getKeyQueryOptions,
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
