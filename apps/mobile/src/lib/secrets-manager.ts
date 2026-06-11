import {
	generateKeyPair,
	KeyType,
	validatePrivateKey,
} from '@fressh/react-native-terminal';
import * as Crypto from 'expo-crypto';
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as Keychain from 'react-native-keychain';
import { appLayer, appRuntime } from './runtime';
import type { StrictOmit } from './utils';

const annotateModule = Effect.annotateLogs({ module: 'SecretsManager' });

/** A keychain write/validation that failed in a way the user may need to see
 *  (the sheets surface `message` via the atom failure). */
class KeychainError extends Data.TaggedError('KeychainError')<{
	message: string;
	cause?: unknown;
}> {}

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
function makeKeychainStore<Metadata, Value>(params: {
	prefix: string;
	/** Codec between the typed metadata and the keychain's string payload. */
	metadataSchema: Schema.Codec<Metadata, string>;
	/** Codec between the typed value and the keychain's string payload. */
	valueSchema: Schema.Codec<Value, string>;
}) {
	const metaPrefix = `${params.prefix}.meta.`;
	const metaService = (id: string) => `${metaPrefix}${id}`;
	const valueService = (id: string) => `${params.prefix}.value.${id}`;

	const decodeMetadata = Schema.decodeSync(params.metadataSchema);
	const encodeMetadata = Schema.encodeSync(params.metadataSchema);
	const decodeValue = Schema.decodeSync(params.valueSchema);
	const encodeValue = Schema.encodeSync(params.valueSchema);

	type Entry = { id: string; metadata: Metadata };

	function parseMetadata(creds: Keychain.UserCredentials) {
		return {
			id: creds.username,
			metadata: decodeMetadata(creds.password),
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
			value: decodeValue(valueCreds.password),
		};
	}

	async function listEntriesWithValues() {
		const entries = await listEntries();
		return Promise.all(entries.map((entry) => getEntry(entry.id)));
	}

	async function upsertEntry(input: {
		id: string;
		metadata: Metadata;
		value: Value;
	}) {
		// Write the secret first, then the metadata. Listing is driven by the
		// metadata service, so even a half-finished write never surfaces an entry
		// whose value is missing.
		await Keychain.setGenericPassword(input.id, encodeValue(input.value), {
			service: valueService(input.id),
		});
		await Keychain.setGenericPassword(
			input.id,
			encodeMetadata(input.metadata),
			{ service: metaService(input.id) },
		);
		appRuntime.runSync(
			Effect.logInfo(`Stored entry ${input.id}`).pipe(annotateModule),
		);
	}

	async function deleteEntry(id: string) {
		// Remove the metadata (the index) first so a half-finished delete can't
		// leave a listed-but-valueless entry.
		await Keychain.resetGenericPassword({ service: metaService(id) });
		await Keychain.resetGenericPassword({ service: valueService(id) });
		appRuntime.runSync(
			Effect.logInfo(`Deleted entry ${id}`).pipe(annotateModule),
		);
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
	metadataSchema: Schema.fromJsonString(keyMetadataSchema),
	valueSchema: Schema.String,
});

const upsertPrivateKey = Effect.fnUntraced(function* (params: {
	keyId?: string;
	metadata: StrictOmit<KeyMetadata, 'createdAtMs'>;
	value: string;
}) {
	// Throws SshError on invalid input; returns the canonical OpenSSH form. We
	// persist the CANONICAL form (not the raw paste) so what round-trips is
	// always a key russh can actually use.
	const canonical = yield* Effect.try({
		try: () => validatePrivateKey(params.value),
		catch: (cause) => new KeychainError({ message: 'Invalid private key', cause }),
	}).pipe(
		Effect.tapError((error) => Effect.logInfo('Invalid private key', error)),
	);
	if (!canonical) {
		return yield* new KeychainError({
			message: 'Private key validation produced an empty key',
		});
	}
	const keyId = params.keyId ?? `key_${Crypto.randomUUID()}`;
	yield* Effect.logInfo(
		`${params.keyId ? 'Upserting' : 'Creating'} private key ${keyId}`,
	);
	// Preserve createdAtMs if the entry already exists
	const existing = yield* Effect.promise(() =>
		keyStore.getEntry(keyId).catch(() => undefined),
	);
	const createdAtMs =
		existing?.metadata.createdAtMs ?? (yield* Clock.currentTimeMillis);

	yield* Effect.tryPromise(() =>
		keyStore.upsertEntry({
			id: keyId,
			metadata: { ...params.metadata, createdAtMs },
			value: canonical,
		}),
	);

	// Read-after-write: the keychain has silently dropped values before (entries
	// that list but whose secret is missing → a cryptic "Value is undefined,
	// expected a String" at connect time). Verify the secret round-trips so a
	// broken write fails HERE, loudly, instead of creating an unusable key. The
	// log records only the LENGTH, never the key material.
	const stored = yield* Effect.promise(() =>
		keyStore.getEntry(keyId).catch(() => undefined),
	);
	yield* Effect.logInfo(
		`Key ${keyId} round-trip: stored length ${stored?.value?.length ?? 'MISSING'}`,
	);
	if (!stored?.value) {
		yield* Effect.promise(() =>
			keyStore.deleteEntry(keyId).catch(() => undefined),
		);
		return yield* new KeychainError({
			message:
				'Keychain failed to persist the private key (value did not round-trip). The key was not saved.',
		});
	}

	return keyId;
}, annotateModule);

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

const connectionMetadataSchema = Schema.Struct({
	priority: Schema.Number,
	createdAtMs: Schema.Int,
	modifiedAtMs: Schema.Int,
	label: Schema.optional(Schema.String),
	// Per-host shell-integration preference (OSC 633 auto-injection). Absent ⇒
	// inherit the default (on). ANDed with the global kill-switch at connect time.
	// See docs/projects/terminal-semantic-events.md.
	shellIntegration: Schema.optional(Schema.Boolean),
});

export type ConnectionMetadata = Schema.Schema.Type<
	typeof connectionMetadataSchema
>;

const connectionStore = makeKeychainStore({
	prefix: 'fressh.connection',
	metadataSchema: Schema.fromJsonString(connectionMetadataSchema),
	valueSchema: Schema.fromJsonString(connectionDetailsSchema),
});

export type InputConnectionDetails = Schema.Schema.Type<
	typeof connectionDetailsSchema
>;

const upsertConnection = Effect.fnUntraced(function* (params: {
	details: InputConnectionDetails;
	priority: number;
	label?: string;
	/** Per-host shell-integration preference. Omit to inherit the default. */
	shellIntegration?: boolean;
}) {
	const id =
		`${params.details.username}-${params.details.host}-${params.details.port}`.replaceAll(
			'.',
			'_',
		);
	// Preserve the original creation time across re-saves (reconnect re-upserts).
	const existing = yield* Effect.promise(() =>
		connectionStore.getEntry(id).catch(() => undefined),
	);
	const now = yield* Clock.currentTimeMillis;
	yield* Effect.tryPromise(() =>
		connectionStore.upsertEntry({
			id,
			metadata: {
				priority: params.priority,
				modifiedAtMs: now,
				createdAtMs: existing?.metadata.createdAtMs ?? now,
				label: params.label,
				shellIntegration: params.shellIntegration,
			},
			value: params.details,
		}),
	);
	return params.details;
});

/** Patch one or more metadata fields of a saved connection without touching its
 *  secret value or the untouched metadata fields. Used by rename + the per-host
 *  shell-integration toggle. No-op (throws) if the connection doesn't exist. */
const updateConnectionMetadata = Effect.fnUntraced(function* (
	id: string,
	patch: Partial<
		Pick<ConnectionMetadata, 'label' | 'shellIntegration' | 'priority'>
	>,
) {
	const entry = yield* Effect.tryPromise(() => connectionStore.getEntry(id));
	const now = yield* Clock.currentTimeMillis;
	yield* Effect.tryPromise(() =>
		connectionStore.upsertEntry({
			id,
			metadata: { ...entry.metadata, ...patch, modifiedAtMs: now },
			value: entry.value,
		}),
	);
});

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
export const atomRuntime = Atom.runtime(appLayer);
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
				yield* Effect.logWarning(
					`Repaired ${defaults.length} default keys → kept ${keep.id}`,
				);
				return results.map((r) => ({
					...r,
					metadata: { ...r.metadata, isDefault: r.id === keep.id },
				}));
			}
			yield* Effect.logInfo(`Listed ${results.length} private keys`);
			return results;
		}).pipe(annotateModule),
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
		yield* upsertPrivateKey({
			metadata: { priority: 0, label: 'New Key', isDefault: false },
			value: pair,
		});
	}),
	{ reactivityKeys: KEYS },
);

const importKeyAtom = runtime.fn(
	Effect.fnUntraced(function* (input: {
		value: string;
		label: string;
		isDefault: boolean;
	}) {
		const keyId = yield* upsertPrivateKey({
			metadata: {
				priority: 0,
				label: input.label,
				isDefault: input.isDefault,
			},
			value: input.value,
		});
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
			yield* upsertPrivateKey({
				keyId: entry.id,
				value: entry.value,
				metadata: {
					priority: entry.metadata.priority,
					label: newLabel,
					isDefault: entry.metadata.isDefault,
				},
			});
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
		yield* upsertConnection(params);
	}),
	{ reactivityKeys: CONNECTIONS },
);

const updateConnectionMetadataAtom = Atom.family((id: string) =>
	runtime.fn(
		Effect.fnUntraced(function* (
			patch: Partial<
				Pick<ConnectionMetadata, 'label' | 'shellIntegration' | 'priority'>
			>,
		) {
			yield* updateConnectionMetadata(id, patch);
		}),
		{ reactivityKeys: CONNECTIONS },
	),
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
			updateConnectionMetadata,
		},
		atoms: {
			list: listConnectionsAtom,
			get: getConnectionAtom,
			delete: deleteConnectionAtom,
			upsert: upsertConnectionAtom,
			updateMetadata: updateConnectionMetadataAtom,
		},
	},
};
