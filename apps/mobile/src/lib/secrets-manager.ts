import { validatePrivateKey } from '@fressh/react-native-terminal';
import { queryOptions } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Keychain from 'react-native-keychain';
import * as z from 'zod';
import { rootLogger } from './logger';
import { queryClient, type StrictOmit } from './utils';

const logger = rootLogger.extend('SecretsManager');

/**
 * A thin store over the device keychain (iOS Keychain / Android Keystore-backed
 * via react-native-keychain). The keychain encrypts every value at rest with a
 * non-exportable, hardware-held key, so we no longer hand-roll encryption or
 * chunking — it has no small per-value size limit and `getAllGenericPasswordServices`
 * enumerates entries natively.
 *
 * Each logical entry is stored as TWO keychain services:
 * - a *metadata* service (`<prefix>.meta.<id>`) — small, listable, never gated
 * - a *value* service (`<prefix>.value.<id>`) — the secret itself
 *
 * Listing only ever reads metadata services, which is what makes future
 * biometric gating clean: attaching `accessControl` to the value services
 * (e.g. {@link Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE})
 * gates {@link getEntry}/{@link getPrivateKey} without prompting during a list.
 */
// TODO: add tests for makeKeychainStore against a mocked react-native-keychain:
// - upsert -> get round-trips metadata + value
// - listEntries returns metadata only and never reads a `.value.` service
// - upsert overwrites in place and upsertPrivateKey preserves createdAtMs
// - deleteEntry removes both services; getEntry then throws
// - half-finished write/delete (only one service present) can't surface a
//   listed-but-valueless entry
function makeKeychainStore<Metadata extends object, Value = string>(params: {
	prefix: string;
	metadataSchema: z.ZodType<Metadata>;
	parseValue: (raw: string) => Value;
}) {
	const metaPrefix = `${params.prefix}.meta.`;
	const metaService = (id: string) => `${metaPrefix}${id}`;
	const valueService = (id: string) => `${params.prefix}.value.${id}`;

	type Entry = { id: string; metadata: Metadata };

	function parseMetadata(creds: Keychain.UserCredentials) {
		return {
			id: creds.username,
			metadata: params.metadataSchema.parse(JSON.parse(creds.password)),
		} satisfies Entry;
	}

	/** Metadata for every entry. Does not read any secret value. */
	async function listEntries() {
		const services = await Keychain.getAllGenericPasswordServices();
		const entries = await Promise.all(
			services
				.filter((service) => service.startsWith(metaPrefix))
				.map(async (service) => {
					const creds = await Keychain.getGenericPassword({ service });
					return creds ? parseMetadata(creds) : null;
				}),
		);
		return entries.filter((entry): entry is Entry => entry !== null);
	}

	async function getEntry(id: string) {
		const [metaCreds, valueCreds] = await Promise.all([
			Keychain.getGenericPassword({ service: metaService(id) }),
			Keychain.getGenericPassword({ service: valueService(id) }),
		]);
		if (!metaCreds || !valueCreds) {
			throw new Error(`Entry not found: ${id}`);
		}
		return {
			...parseMetadata(metaCreds),
			value: params.parseValue(valueCreds.password),
		};
	}

	async function listEntriesWithValues() {
		const entries = await listEntries();
		return Promise.all(entries.map((entry) => getEntry(entry.id)));
	}

	async function upsertEntry(input: {
		id: string;
		metadata: Metadata;
		value: string;
	}) {
		// Write the secret first, then the metadata. Listing is driven by the
		// metadata service, so even a half-finished write never surfaces an entry
		// whose value is missing.
		await Keychain.setGenericPassword(input.id, input.value, {
			service: valueService(input.id),
		});
		await Keychain.setGenericPassword(
			input.id,
			JSON.stringify(input.metadata),
			{ service: metaService(input.id) },
		);
		logger.info(`Stored entry ${input.id}`);
	}

	async function deleteEntry(id: string) {
		// Remove the metadata (the index) first so a half-finished delete can't
		// leave a listed-but-valueless entry.
		await Keychain.resetGenericPassword({ service: metaService(id) });
		await Keychain.resetGenericPassword({ service: valueService(id) });
		logger.info(`Deleted entry ${id}`);
	}

	return {
		listEntries,
		getEntry,
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

const keyStore = makeKeychainStore({
	prefix: 'fressh.key',
	metadataSchema: keyMetadataSchema,
	parseValue: (value) => value,
});

async function upsertPrivateKey(params: {
	keyId?: string;
	metadata: StrictOmit<KeyMetadata, 'createdAtMs'>;
	value: string;
}) {
	try {
		// Throws SshError on invalid input; returns the canonical OpenSSH form.
		validatePrivateKey(params.value);
	} catch (error) {
		logger.info('Invalid private key', error);
		throw new Error('Invalid private key', { cause: error });
	}
	const keyId = params.keyId ?? `key_${Crypto.randomUUID()}`;
	logger.info(`${params.keyId ? 'Upserting' : 'Creating'} private key ${keyId}`);
	// Preserve createdAtMs if the entry already exists
	const existing = await keyStore.getEntry(keyId).catch(() => undefined);
	const createdAtMs = existing?.metadata.createdAtMs ?? Date.now();

	await keyStore.upsertEntry({
		id: keyId,
		metadata: { ...params.metadata, createdAtMs },
		value: params.value,
	});
	await queryClient.invalidateQueries({ queryKey: [keyQueryKey] });
}

async function deletePrivateKey(keyId: string) {
	await keyStore.deleteEntry(keyId);
	await queryClient.invalidateQueries({ queryKey: [keyQueryKey] });
}

const keyQueryKey = 'keys';

const listKeysQueryOptions = queryOptions({
	queryKey: [keyQueryKey],
	queryFn: async () => {
		const results = await keyStore.listEntries();
		logger.info(`Listed ${results.length} private keys`);
		return results;
	},
});

const getKeyQueryOptions = (keyId: string) =>
	queryOptions({
		queryKey: [keyQueryKey, keyId],
		queryFn: () => keyStore.getEntry(keyId),
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

const connectionStore = makeKeychainStore({
	prefix: 'fressh.connection',
	metadataSchema: z.object({
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
	await connectionStore.upsertEntry({
		id,
		metadata: {
			priority: params.priority,
			modifiedAtMs: Date.now(),
			createdAtMs: Date.now(),
			label: params.label,
		},
		value: JSON.stringify(params.details),
	});
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
	return params.details;
}

async function deleteConnection(id: string) {
	await connectionStore.deleteEntry(id);
	await queryClient.invalidateQueries({ queryKey: [connectionQueryKey] });
}

const connectionQueryKey = 'connections';

const listConnectionsQueryOptions = queryOptions({
	queryKey: [connectionQueryKey],
	queryFn: () => connectionStore.listEntries(),
});

const getConnectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: [connectionQueryKey, id],
		queryFn: () => connectionStore.getEntry(id),
	});

export const secretsManager = {
	keys: {
		utils: {
			upsertPrivateKey,
			deletePrivateKey,
			listEntriesWithValues: keyStore.listEntriesWithValues,
			getPrivateKey: (keyId: string) => keyStore.getEntry(keyId),
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
