import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

/**
 * Known-hosts pure logic — TOFU host-key pinning à la OpenSSH `known_hosts`.
 *
 * NO React-Native / store imports live here on purpose: everything is pure
 * data-in/data-out so it can be unit-tested with `bun test` (see
 * known-hosts.test.ts). The MMKV-backed CRUD + prompt plumbing live in
 * `lib/host-keys.ts`, which wraps this module.
 *
 * Pinning is per-(host, port, algorithm): a server legitimately presents
 * different keys per algorithm (ed25519 + rsa), so only a *same-algorithm*
 * fingerprint mismatch is the danger signal. See
 * docs/projects/host-key-verification.md.
 */

const knownHostEntrySchema = Schema.Struct({
	host: Schema.String,
	port: Schema.Number,
	/** Key algorithm, e.g. "ssh-ed25519". */
	algorithm: Schema.String,
	/** The identity we compare on (what the prompt shows the user). */
	fingerprintSha256: Schema.String,
	keyBase64: Schema.String,
	trustedAtMs: Schema.Number.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(0)),
	),
});

export type KnownHostEntry = Schema.Schema.Type<typeof knownHostEntrySchema>;

/** What a HostKeyPending event presents (subset of ServerPublicKeyInfo). */
export interface PresentedHostKey {
	host: string;
	port: number;
	algorithm: string;
	fingerprintSha256: string;
	keyBase64: string;
}

export type HostKeyVerdict =
	| { kind: 'trusted' }
	| { kind: 'unknown' }
	| { kind: 'changed'; prior: KnownHostEntry };

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeEntry = Schema.decodeUnknownOption(knownHostEntrySchema);

/** The persisted shape: the whole pin list as one JSON string. */
const knownHostsJsonSchema = Schema.fromJsonString(
	Schema.Array(knownHostEntrySchema),
);

/** Serialize the pin list for the `knownHosts` pref. */
export const encodeKnownHosts = Schema.encodeSync(knownHostsJsonSchema);

/** Tolerant parse: drop anything that isn't a well-formed entry, `[]` on
 *  garbage. Fails safe — a corrupt store re-prompts, it never silently trusts.
 *  (Decoded per entry, NOT via {@link knownHostsJsonSchema} — one malformed
 *  entry must not invalidate every other pin.) */
export function parseKnownHosts(json: string): KnownHostEntry[] {
	const raw = decodeJson(json);
	if (Option.isNone(raw) || !Array.isArray(raw.value)) {
		return [];
	}
	return raw.value.flatMap((item) => {
		const entry = decodeEntry(item);
		return Option.isSome(entry) ? [entry.value] : [];
	});
}

const sameTarget = (e: KnownHostEntry, info: PresentedHostKey) =>
	e.host === info.host && e.port === info.port && e.algorithm === info.algorithm;

/**
 * Match on (host, port, algorithm):
 * - same algorithm + same fingerprint → trusted (silent accept)
 * - same algorithm + different fingerprint → changed (the MITM signal)
 * - no entry for this algorithm → unknown (first-use prompt), even if the host
 *   is pinned under other algorithms.
 */
export function evaluateHostKey(
	entries: KnownHostEntry[],
	info: PresentedHostKey,
): HostKeyVerdict {
	const prior = entries.find((e) => sameTarget(e, info));
	if (!prior) {
		return { kind: 'unknown' };
	}
	return prior.fingerprintSha256 === info.fingerprintSha256
		? { kind: 'trusted' }
		: { kind: 'changed', prior };
}

/** Replace the entry with the same (host, port, algorithm) or append. Replacing
 *  (not appending) is what un-trusts the old key on a changed-key accept. */
export function upsertEntry(
	entries: KnownHostEntry[],
	entry: KnownHostEntry,
): KnownHostEntry[] {
	const rest = entries.filter((e) => !sameTarget(e, entry));
	return [...rest, entry];
}

/** Remove every entry for host:port (revoke, mirrors `ssh-keygen -R`). */
export function removeHost(
	entries: KnownHostEntry[],
	host: string,
	port: number,
): KnownHostEntry[] {
	return entries.filter((e) => !(e.host === host && e.port === port));
}

/** Display label for a pinned target. */
export function hostPortLabel(host: string, port: number): string {
	return `${host}:${port}`;
}
