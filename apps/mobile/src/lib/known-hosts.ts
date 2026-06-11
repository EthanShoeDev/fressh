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

export interface KnownHostEntry {
	host: string;
	port: number;
	/** Key algorithm, e.g. "ssh-ed25519". */
	algorithm: string;
	/** The identity we compare on (what the prompt shows the user). */
	fingerprintSha256: string;
	keyBase64: string;
	trustedAtMs: number;
}

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

/** Tolerant parse: drop anything that isn't a well-formed entry, `[]` on
 *  garbage. Fails safe — a corrupt store re-prompts, it never silently trusts. */
export function parseKnownHosts(json: string): KnownHostEntry[] {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.flatMap((entry): KnownHostEntry[] => {
		if (
			entry &&
			typeof entry === 'object' &&
			typeof (entry as KnownHostEntry).host === 'string' &&
			typeof (entry as KnownHostEntry).port === 'number' &&
			typeof (entry as KnownHostEntry).algorithm === 'string' &&
			typeof (entry as KnownHostEntry).fingerprintSha256 === 'string' &&
			typeof (entry as KnownHostEntry).keyBase64 === 'string'
		) {
			const e = entry as KnownHostEntry;
			return [
				{
					host: e.host,
					port: e.port,
					algorithm: e.algorithm,
					fingerprintSha256: e.fingerprintSha256,
					keyBase64: e.keyBase64,
					trustedAtMs: typeof e.trustedAtMs === 'number' ? e.trustedAtMs : 0,
				},
			];
		}
		return [];
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
