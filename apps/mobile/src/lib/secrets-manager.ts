import {
	generateKeyPair,
	KeyType,
	validatePrivateKey,
} from '@fressh/react-native-terminal';
import * as Crypto from 'expo-crypto';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as Keychain from 'react-native-keychain';
import { rootLogger } from './logger';
import type { StrictOmit } from './utils';

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
function makeKeychainStore<Metadata, Value = string>(params: {
	prefix: string;
	decodeMetadata: (raw: unknown) => Metadata;
	parseValue: (raw: string) => Value;
}) {
	const metaPrefix = `${params.prefix}.meta.`;
	const metaService = (id: string) => `${metaPrefix}${id}`;
	const valueService = (id: string) => `${params.prefix}.value.${id}`;

	type Entry = { id: string; metadata: Metadata };

	function parseMetadata(creds: Keychain.UserCredentials) {
		return {
			id: creds.username,
			metadata: params.decodeMetadata(JSON.parse(creds.password)),
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
		// An entry whose secret didn't persist (value service present but empty)
		// must be treated as not-found. Returning `{ value: undefined }` here is
		// what produced the cryptic "Value is undefined, expected a String" at the
		// native boundary; fail clearly instead.
		if (!metaCreds || !valueCreds || !valueCreds.password) {
			throw new Error(`Entry not found or value missing: ${id}`);
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

const keyMetadataSchema = Schema.Struct({
	priority: Schema.Number,
	createdAtMs: Schema.Int,
	// Optional display name for the key
	label: Schema.optional(Schema.String),
	// Optional default flag
	isDefault: Schema.optional(Schema.Boolean),
});
export type KeyMetadata = Schema.Schema.Type<typeof keyMetadataSchema>;

const keyStore = makeKeychainStore({
	prefix: 'fressh.key',
	decodeMetadata: Schema.decodeUnknownSync(keyMetadataSchema),
	parseValue: (value) => value,
});

async function upsertPrivateKey(params: {
	keyId?: string;
	metadata: StrictOmit<KeyMetadata, 'createdAtMs'>;
	value: string;
}) {
	// Throws SshError on invalid input; returns the canonical OpenSSH form. We
	// persist the CANONICAL form (not the raw paste) so what round-trips is
	// always a key russh can actually use.
	let canonical: string;
	try {
		canonical = validatePrivateKey(params.value);
	} catch (error) {
		logger.info('Invalid private key', error);
		throw new Error('Invalid private key', { cause: error });
	}
	if (!canonical) {
		throw new Error('Private key validation produced an empty key');
	}
	const keyId = params.keyId ?? `key_${Crypto.randomUUID()}`;
	logger.info(`${params.keyId ? 'Upserting' : 'Creating'} private key ${keyId}`);
	// Preserve createdAtMs if the entry already exists
	const existing = await keyStore.getEntry(keyId).catch(() => undefined);
	const createdAtMs = existing?.metadata.createdAtMs ?? Date.now();

	await keyStore.upsertEntry({
		id: keyId,
		metadata: { ...params.metadata, createdAtMs },
		value: canonical,
	});

	// Read-after-write: the keychain has silently dropped values before (entries
	// that list but whose secret is missing → a cryptic "Value is undefined,
	// expected a String" at connect time). Verify the secret round-trips so a
	// broken write fails HERE, loudly, instead of creating an unusable key. The
	// log records only the LENGTH, never the key material.
	const stored = await keyStore.getEntry(keyId).catch(() => undefined);
	logger.info(
		`Key ${keyId} round-trip: stored length ${stored?.value?.length ?? 'MISSING'}`,
	);
	if (!stored?.value) {
		await keyStore.deleteEntry(keyId).catch(() => undefined);
		throw new Error(
			'Keychain failed to persist the private key (value did not round-trip). The key was not saved.',
		);
	}

	return keyId;
}

/**
 * Enforce the invariant that AT MOST ONE key is the default. Rewrites only the
 * entries whose `isDefault` disagrees with `defaultId` (pass `undefined` to
 * clear all defaults). Writes are serialized on purpose — concurrent keychain
 * writes to the shared DataStore can clobber one another.
 */
async function enforceSingleDefault(defaultId: string | undefined) {
	const entries = await keyStore.listEntries();
	for (const entry of entries) {
		const shouldBeDefault = entry.id === defaultId;
		if (!!entry.metadata.isDefault === shouldBeDefault) {
			continue;
		}
		const full = await keyStore.getEntry(entry.id).catch(() => undefined);
		if (!full) {
			continue;
		}
		await keyStore.upsertEntry({
			id: entry.id,
			value: full.value,
			metadata: { ...full.metadata, isDefault: shouldBeDefault },
		});
	}
}

async function deletePrivateKey(keyId: string) {
	await keyStore.deleteEntry(keyId);
}

export const connectionDetailsSchema = Schema.Struct({
	host: Schema.NonEmptyString,
	port: Schema.Number.check(Schema.isGreaterThanOrEqualTo(1)),
	username: Schema.NonEmptyString,
	security: Schema.Union([
		Schema.Struct({
			type: Schema.Literal('password'),
			password: Schema.NonEmptyString,
		}),
		Schema.Struct({
			type: Schema.Literal('key'),
			keyId: Schema.NonEmptyString,
		}),
	]),
});

/** Standard Schema bridge so TanStack Form can validate with the Effect schema. */
export const connectionDetailsStandardSchema = Schema.toStandardSchemaV1(
	connectionDetailsSchema,
);

const connectionStore = makeKeychainStore({
	prefix: 'fressh.connection',
	decodeMetadata: Schema.decodeUnknownSync(
		Schema.Struct({
			priority: Schema.Number,
			createdAtMs: Schema.Int,
			modifiedAtMs: Schema.Int,
			label: Schema.optional(Schema.String),
		}),
	),
	parseValue: (value) =>
		Schema.decodeUnknownSync(connectionDetailsSchema)(JSON.parse(value)),
});

export type InputConnectionDetails = Schema.Schema.Type<
	typeof connectionDetailsSchema
>;

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
	return params.details;
}

async function deleteConnection(id: string) {
	await connectionStore.deleteEntry(id);
}

// ---------------------------------------------------------------------------
// effect-atom layer
//
// One shared runtime drives reactivity-based invalidation (the effect-atom
// analogue of TanStack Query's `queryClient.invalidateQueries`). Query atoms tag
// themselves with `Atom.withReactivity([...])`; firing a mutation atom created
// with the matching `reactivityKeys` auto-refreshes them.
// ---------------------------------------------------------------------------

/**
 * Shared atom runtime. Exported so other modules (e.g. the SSH connect flow in
 * `query-fns`) can build atoms whose `reactivityKeys` invalidate the query atoms
 * defined here — reactivity is scoped to a single runtime's Reactivity service.
 */
export const atomRuntime = Atom.runtime(Layer.empty);
const runtime = atomRuntime;

const KEYS = ['keys'] as const;
const CONNECTIONS = ['connections'] as const;

const listKeysAtom = runtime
	.atom(
		Effect.gen(function* () {
			const results = yield* Effect.tryPromise(() => keyStore.listEntries());
			const defaults = results.filter((r) => r.metadata.isDefault);
			if (defaults.length > 1) {
				// Invariant repair: at most one key may be default. Collapse an
				// already-corrupted state (e.g. the old double-import-as-default bug)
				// to a single default — the most recently created — and persist it.
				const keep = defaults.reduce((a, b) =>
					(a.metadata.createdAtMs ?? 0) >= (b.metadata.createdAtMs ?? 0)
						? a
						: b,
				);
				yield* Effect.tryPromise(() => enforceSingleDefault(keep.id));
				logger.warn(`Repaired ${defaults.length} default keys → kept ${keep.id}`);
				return results.map((r) => ({
					...r,
					metadata: { ...r.metadata, isDefault: r.id === keep.id },
				}));
			}
			logger.info(`Listed ${results.length} private keys`);
			return results;
		}),
	)
	.pipe(Atom.withReactivity(KEYS));

const getKeyAtom = Atom.family((keyId: string) =>
	runtime
		.atom(Effect.tryPromise(() => keyStore.getEntry(keyId)))
		.pipe(Atom.withReactivity(KEYS)),
);

const generateKeyAtom = runtime.fn(
	Effect.fnUntraced(function* () {
		const pair = generateKeyPair(KeyType.Ed25519);
		yield* Effect.tryPromise(() =>
			upsertPrivateKey({
				metadata: { priority: 0, label: 'New Key', isDefault: false },
				value: pair,
			}),
		);
	}),
	{ reactivityKeys: KEYS },
);

const importKeyAtom = runtime.fn(
	Effect.fnUntraced(function* (input: {
		value: string;
		label: string;
		isDefault: boolean;
	}) {
		const keyId = yield* Effect.tryPromise(() =>
			upsertPrivateKey({
				metadata: {
					priority: 0,
					label: input.label,
					isDefault: input.isDefault,
				},
				value: input.value,
			}),
		);
		// Setting this key default means UN-setting every other one.
		if (input.isDefault) {
			yield* Effect.tryPromise(() => enforceSingleDefault(keyId));
		}
		// Returning the id (not void) lets the import sheet detect success and
		// close itself.
		return keyId;
	}),
	{ reactivityKeys: KEYS },
);

const renameKeyAtom = Atom.family((entryId: string) =>
	runtime.fn(
		Effect.fnUntraced(function* (newLabel: string) {
			const entry = yield* Effect.tryPromise(() => keyStore.getEntry(entryId));
			yield* Effect.tryPromise(() =>
				upsertPrivateKey({
					keyId: entry.id,
					value: entry.value,
					metadata: {
						priority: entry.metadata.priority,
						label: newLabel,
						isDefault: entry.metadata.isDefault,
					},
				}),
			);
		}),
		{ reactivityKeys: KEYS },
	),
);

const deleteKeyAtom = Atom.family((entryId: string) =>
	runtime.fn(
		Effect.fnUntraced(function* () {
			yield* Effect.tryPromise(() => deletePrivateKey(entryId));
		}),
		{ reactivityKeys: KEYS },
	),
);

const setDefaultKeyAtom = Atom.family((entryId: string) =>
	runtime.fn(
		Effect.fnUntraced(function* () {
			yield* Effect.tryPromise(() => enforceSingleDefault(entryId));
		}),
		{ reactivityKeys: KEYS },
	),
);

const listConnectionsAtom = runtime
	.atom(Effect.tryPromise(() => connectionStore.listEntries()))
	.pipe(Atom.withReactivity(CONNECTIONS));

const getConnectionAtom = Atom.family((id: string) =>
	runtime
		.atom(Effect.tryPromise(() => connectionStore.getEntry(id)))
		.pipe(Atom.withReactivity(CONNECTIONS)),
);

const deleteConnectionAtom = Atom.family((id: string) =>
	runtime.fn(
		Effect.fnUntraced(function* () {
			yield* Effect.tryPromise(() => deleteConnection(id));
		}),
		{ reactivityKeys: CONNECTIONS },
	),
);

const upsertConnectionAtom = runtime.fn(
	Effect.fnUntraced(function* (params: {
		details: InputConnectionDetails;
		priority: number;
		label?: string;
	}) {
		yield* Effect.tryPromise(() => upsertConnection(params));
	}),
	{ reactivityKeys: CONNECTIONS },
);

export const secretsManager = {
	/** Invalidate query atoms after a non-atom mutation (e.g. the connect flow). */
	reactivityKeys: { keys: KEYS, connections: CONNECTIONS },
	keys: {
		utils: {
			getPrivateKey: (keyId: string) => keyStore.getEntry(keyId),
			listEntriesWithValues: keyStore.listEntriesWithValues,
		},
		atoms: {
			list: listKeysAtom,
			get: getKeyAtom,
			generate: generateKeyAtom,
			import: importKeyAtom,
			rename: renameKeyAtom,
			delete: deleteKeyAtom,
			setDefault: setDefaultKeyAtom,
		},
	},
	connections: {
		utils: {
			upsertConnection,
		},
		atoms: {
			list: listConnectionsAtom,
			get: getConnectionAtom,
			delete: deleteConnectionAtom,
			upsert: upsertConnectionAtom,
		},
	},
};
