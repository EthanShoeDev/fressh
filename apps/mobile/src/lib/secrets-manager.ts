import { RnRussh, SshError_Tags } from '@fressh/react-native-uniffi-russh';
import { queryOptions } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { MMKV } from 'react-native-mmkv';
import * as z from 'zod';
import { makeBetterSecureStore } from './chunked-storage';
import {
	connectionMetadataSchema,
	createConnectionStorage,
	storedConnectionDetailsSchema,
	type StoredConnectionDetails,
} from './connection-storage';
import { rootLogger } from './logger';
import { queryClient, type StrictOmit } from './utils';

export {
	connectionDetailsSchema,
	type InputConnectionDetails,
	type StoredConnectionDetails,
} from './connection-storage';

const logger = rootLogger.extend('SecretsManager');

const secureStoreAdapter = {
	getItem: (key: string) => SecureStore.getItemAsync(key),
	setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
	deleteItem: (key: string) => SecureStore.deleteItemAsync(key),
};

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
	storage: secureStoreAdapter,
	randomUUID: () => Crypto.randomUUID(),
	logger,
});

async function upsertPrivateKey(params: {
	keyId?: string;
	metadata: StrictOmit<KeyMetadata, 'createdAtMs'>;
	value: string;
}) {
	const validateKeyResult = RnRussh.validatePrivateKey(params.value);
	if (!validateKeyResult.valid) {
		logger.info('Invalid private key', validateKeyResult.error);
		if (validateKeyResult.error.tag === SshError_Tags.RusshKeys) {
			logger.info('Invalid private key inner', validateKeyResult.error.inner);
			logger.info('Invalid private key content', params.value);
		}
		throw new Error('Invalid private key', { cause: validateKeyResult.error });
	}
	const keyId = params.keyId ?? `key_${Crypto.randomUUID()}`;
	logger.info(
		`${params.keyId ? 'Upserting' : 'Creating'} private key ${keyId}`,
	);
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
	logger.debug('invalidating key query');
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
		logger.info(`Listed ${results.length} private keys`);
		return results;
	},
});

const getKeyQueryOptions = (keyId: string) =>
	queryOptions({
		queryKey: [keyQueryKey, keyId],
		queryFn: () => betterKeyStorage.getEntry(keyId),
	});

const legacyConnectionStorage = makeBetterSecureStore<
	z.infer<typeof connectionMetadataSchema>,
	StoredConnectionDetails
>({
	storagePrefix: 'connection',
	extraManifestFieldsSchema: connectionMetadataSchema,
	parseValue: (value) => storedConnectionDetailsSchema.parse(JSON.parse(value)),
	storage: secureStoreAdapter,
	randomUUID: () => Crypto.randomUUID(),
	logger,
});
const connectionMmkv = new MMKV({ id: 'connections' });
const connectionStorage = createConnectionStorage({
	storage: {
		getString: (key) => connectionMmkv.getString(key) ?? undefined,
		set: (key, value) => {
			connectionMmkv.set(key, value);
		},
		delete: (key) => {
			connectionMmkv.delete(key);
		},
	},
	legacyStorage: legacyConnectionStorage,
	logger: rootLogger.extend('ConnectionStorage'),
});

async function upsertConnection(params: {
	details: StoredConnectionDetails;
	priority: number;
	label?: string;
}) {
	const normalizedDetails = await connectionStorage.upsertConnection(params);
	logger.debug('invalidating connection query');
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
	return normalizedDetails;
}

async function deleteConnection(id: string) {
	await connectionStorage.deleteConnection(id);
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
}

const connectionQueryKey = 'connections';

const listConnectionsQueryOptions = queryOptions({
	queryKey: [connectionQueryKey],
	queryFn: () => connectionStorage.listEntriesWithValues(),
});

const getConnectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: [connectionQueryKey, id],
		queryFn: () => connectionStorage.getEntry(id).catch(() => null),
	});

async function initializeSecretsManager() {
	await connectionStorage.ensureReady();
}

export const secretsManager = {
	initialize: initializeSecretsManager,
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
			ensureReady: connectionStorage.ensureReady,
			upsertConnection,
			deleteConnection,
			listEntriesWithValues: connectionStorage.listEntriesWithValues,
		},
		query: {
			list: listConnectionsQueryOptions,
			get: getConnectionQueryOptions,
		},
	},
};
