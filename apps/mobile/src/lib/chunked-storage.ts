import * as z from 'zod';

type LoggerLike = Pick<
	Console,
	'debug' | 'info' | 'warn' | 'error'
>;

export type AsyncStringStorage = {
	getItem: (key: string) => Promise<string | null>;
	setItem: (key: string, value: string) => Promise<void>;
	deleteItem: (key: string) => Promise<void>;
};

export type ChunkedStoreEntry<T extends object> = {
	id: string;
	chunkCount: number;
	metadata: T;
};

type RootManifest = {
	manifestVersion: number;
	manifestChunksIds: string[];
};

const noopLogger: LoggerLike = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

export function buildChunkedStoreKeys(storagePrefix: string) {
	return {
		rootManifestKey: [storagePrefix, 'rootManifest'].join('-'),
		manifestChunkKey: (manifestChunkId: string) =>
			[storagePrefix, 'manifestChunk', manifestChunkId].join('-'),
		entryKey: (entryId: string, chunkIdx: number) =>
			[storagePrefix, 'entry', entryId, 'chunk', chunkIdx].join('-'),
	};
}

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
 * The implementation is storage-agnostic so we can test migration logic
 * without depending on the native Expo module.
 */
export function makeBetterSecureStore<
	T extends object = object,
	Value = string,
>(storeParams: {
	storagePrefix: string;
	parseValue: (value: string) => Value;
	storage: AsyncStringStorage;
	randomUUID: () => string;
	logger?: LoggerLike;
	extraManifestFieldsSchema?: z.ZodType<T>;
}) {
	const sizeLimit = 2000;
	const rootManifestVersion = 1;
	const manifestChunkVersion = 1;
	const logger = storeParams.logger ?? noopLogger;
	const storage = storeParams.storage;
	const keys = buildChunkedStoreKeys(storeParams.storagePrefix);
	const metadataSchema = (storeParams.extraManifestFieldsSchema ??
		z.object({})) as z.ZodType<T>;

	const rootManifestSchema = z.looseObject({
		manifestVersion: z.number().default(rootManifestVersion),
		// We need to chunk the manifest itself
		manifestChunksIds: z.array(z.string()),
	});

	const entrySchema = z.object({
		id: z.string(),
		chunkCount: z.number().default(1),
		metadata: metadataSchema,
	});

	type Entry = z.infer<typeof entrySchema>;

	const manifestChunkSchema = z.object({
		manifestChunkVersion: z.number().default(manifestChunkVersion),
		entries: z.array(entrySchema),
	});

	async function persistRootManifest(rootManifest: RootManifest) {
		await storage.setItem(keys.rootManifestKey, JSON.stringify(rootManifest));
	}

	async function getManifest() {
		const rawRootManifestString = await storage.getItem(keys.rootManifestKey);

		logger.debug('rawRootManifestString', rawRootManifestString);
		logger.info(
			`Root manifest for ${keys.rootManifestKey} is ${rawRootManifestString?.length ?? 0} bytes`,
		);
		const unsafedRootManifest: unknown = rawRootManifestString
			? JSON.parse(rawRootManifestString)
			: {
					manifestVersion: rootManifestVersion,
					manifestChunksIds: [],
				};
		const rootManifest = rootManifestSchema.parse(unsafedRootManifest);
		const manifestChunks: {
			manifestChunk: z.infer<typeof manifestChunkSchema>;
			manifestChunkId: string;
			manifestChunkSize: number;
		}[] = [];
		const invalidManifestChunkIds: string[] = [];

		for (const manifestChunkId of rootManifest.manifestChunksIds) {
			const manifestChunkKeyString = keys.manifestChunkKey(manifestChunkId);
			const rawManifestChunkString =
				await storage.getItem(manifestChunkKeyString);
			if (!rawManifestChunkString) {
				logger.warn('Pruning missing manifest chunk reference', {
					rootManifestKey: keys.rootManifestKey,
					manifestChunkId,
				});
				invalidManifestChunkIds.push(manifestChunkId);
				continue;
			}
			logger.info(
				`Manifest chunk for ${manifestChunkKeyString} is ${rawManifestChunkString.length} bytes`,
			);
			try {
				const unsafedManifestChunk: unknown = JSON.parse(rawManifestChunkString);
				manifestChunks.push({
					manifestChunk: manifestChunkSchema.parse(unsafedManifestChunk),
					manifestChunkId,
					manifestChunkSize: rawManifestChunkString.length,
				});
			} catch (error) {
				logger.warn('Pruning invalid manifest chunk reference', {
					rootManifestKey: keys.rootManifestKey,
					manifestChunkId,
					error: String(error),
				});
				invalidManifestChunkIds.push(manifestChunkId);
				await storage.deleteItem(manifestChunkKeyString).catch(() => {
					logger.warn('Failed to delete invalid manifest chunk', {
						manifestChunkKeyString,
					});
				});
			}
		}

		if (invalidManifestChunkIds.length > 0) {
			rootManifest.manifestChunksIds = rootManifest.manifestChunksIds.filter(
				(manifestChunkId) => !invalidManifestChunkIds.includes(manifestChunkId),
			);
			await persistRootManifest(rootManifest);
		}
		return {
			rootManifest,
			manifestChunks,
		};
	}

	async function getEntryValueFromManifestEntry(
		manifestEntry: Entry,
	): Promise<Value> {
		const rawEntryChunks = await Promise.all(
			Array.from({ length: manifestEntry.chunkCount }, async (_, chunkIdx) => {
				const entryKeyString = keys.entryKey(manifestEntry.id, chunkIdx);
				const rawEntryChunk = await storage.getItem(entryKeyString);
				logger.info(
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
			(_, manifestChunk) =>
				manifestChunk.manifestChunk.entries.find((entry) => entry.id === id),
			undefined,
		);
		if (!manifestEntry) throw new Error('Entry not found');

		return {
			value: await getEntryValueFromManifestEntry(manifestEntry),
			manifestEntry,
		};
	}

	async function listEntries() {
		const manifest = await getManifest();
		return manifest.manifestChunks.flatMap(
			(manifestChunk) => manifestChunk.manifestChunk.entries,
		);
	}

	async function listEntriesWithValues(): Promise<(Entry & { value: Value })[]> {
		const manifestEntries = await listEntries();
		return await Promise.all(
			manifestEntries.map(async (entry) => {
				return {
					...entry,
					value: await getEntryValueFromManifestEntry(entry),
				} as Entry & { value: Value };
			}),
		);
	}

	async function deleteEntry(id: string) {
		let manifest = await getManifest();
		const manifestChunkContainingEntry = manifest.manifestChunks.find(
			(manifestChunk) =>
				manifestChunk.manifestChunk.entries.some((entry) => entry.id === id),
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
					await storage.deleteItem(keys.entryKey(id, chunkIdx));
				},
			),
			storage.setItem(
				keys.manifestChunkKey(manifestChunkContainingEntry.manifestChunkId),
				JSON.stringify({
					...manifestChunkContainingEntry.manifestChunk,
					entries: manifestChunkContainingEntry.manifestChunk.entries.filter(
						(entry) => entry.id !== id,
					),
				}),
			),
		]);

		manifest = await getManifest();

		const emptyManifestChunks = manifest.manifestChunks.filter(
			(manifestChunk) => manifestChunk.manifestChunk.entries.length === 0,
		);
		if (emptyManifestChunks.length === 0) return;

		logger.debug('removing empty manifest chunks', emptyManifestChunks.length);
		manifest.rootManifest.manifestChunksIds =
			manifest.rootManifest.manifestChunksIds.filter(
				(manifestChunkId) =>
					!emptyManifestChunks.some(
						(manifestChunk) =>
							manifestChunk.manifestChunkId === manifestChunkId,
					),
			);
		await Promise.all([
			...emptyManifestChunks.map(async (manifestChunk) => {
				await storage.deleteItem(keys.manifestChunkKey(manifestChunk.manifestChunkId));
			}),
			persistRootManifest(manifest.rootManifest),
		]);
	}

	async function clearAllEntries() {
		const manifest = await getManifest().catch(() => ({
			rootManifest: {
				manifestVersion: rootManifestVersion,
				manifestChunksIds: [],
			},
			manifestChunks: [],
		}));
		await Promise.allSettled([
			storage.deleteItem(keys.rootManifestKey),
			...manifest.rootManifest.manifestChunksIds.map(async (manifestChunkId) => {
				await storage.deleteItem(keys.manifestChunkKey(manifestChunkId));
			}),
			...manifest.manifestChunks.flatMap((manifestChunk) =>
				manifestChunk.manifestChunk.entries.flatMap((entry) =>
					Array.from({ length: entry.chunkCount }, async (_, chunkIdx) => {
						await storage.deleteItem(keys.entryKey(entry.id, chunkIdx));
					}),
				),
			),
		]);
	}

	async function upsertEntry(params: {
		id: string;
		metadata: T;
		value: string;
	}) {
		await deleteEntry(params.id).catch(() => {
			logger.info(`Entry ${params.id} not found, creating new one`);
		});

		const valueChunks = splitIntoChunks(params.value, sizeLimit);
		const newManifestEntry = entrySchema.parse({
			id: params.id,
			chunkCount: valueChunks.length,
			metadata: params.metadata,
		} satisfies Entry);
		const newManifestEntrySize = JSON.stringify(newManifestEntry).length;
		if (newManifestEntrySize > sizeLimit / 2) {
			throw new Error('Manifest entry size is too large');
		}
		const manifest = await getManifest();

		const existingManifestChunkWithRoom = manifest.manifestChunks.find(
			(manifestChunk) =>
				sizeLimit > manifestChunk.manifestChunkSize + newManifestEntrySize,
		);
		logger.debug(
			'existingManifestChunkWithRoom',
			existingManifestChunkWithRoom,
		);
		const manifestChunkWithRoom =
			existingManifestChunkWithRoom ??
			(await (async () => {
				const newManifestChunk = {
					manifestChunk: {
						entries: [],
						manifestChunkVersion: manifestChunkVersion,
					},
					manifestChunkId: storeParams.randomUUID(),
					manifestChunkSize: 0,
				} satisfies NonNullable<(typeof manifest.manifestChunks)[number]>;
				logger.info(
					`Adding new manifest chunk ${newManifestChunk.manifestChunkId}`,
				);
				manifest.rootManifest.manifestChunksIds.push(
					newManifestChunk.manifestChunkId,
				);
				await persistRootManifest(manifest.rootManifest);
				logger.debug('newRootManifest', manifest.rootManifest);
				return newManifestChunk;
			})());

		manifestChunkWithRoom.manifestChunk.entries.push(newManifestEntry);
		const manifestChunkKeyString = keys.manifestChunkKey(
			manifestChunkWithRoom.manifestChunkId,
		);
		await Promise.all([
			storage.setItem(
				manifestChunkKeyString,
				JSON.stringify(manifestChunkWithRoom.manifestChunk),
			).then(() => {
				logger.info(
					`Set manifest chunk for ${manifestChunkKeyString} to ${JSON.stringify(manifestChunkWithRoom.manifestChunk).length} bytes`,
				);
			}),
			...valueChunks.map(async (valueChunk, chunkIdx) => {
				const entryKeyString = keys.entryKey(newManifestEntry.id, chunkIdx);
				logger.debug('setting entry chunk', entryKeyString);
				await storage.setItem(entryKeyString, valueChunk);
				logger.info(
					`Set entry chunk for ${entryKeyString} ${chunkIdx} to ${valueChunk.length} bytes`,
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
		clearAllEntries,
	};
}
