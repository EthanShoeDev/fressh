import { describe, expect, test } from 'bun:test';
import {
	evaluateHostKey,
	hostPortLabel,
	type KnownHostEntry,
	parseKnownHosts,
	removeHost,
	upsertEntry,
} from './known-hosts';

const entry = (over: Partial<KnownHostEntry> = {}): KnownHostEntry => ({
	host: 'example.com',
	port: 22,
	algorithm: 'ssh-ed25519',
	fingerprintSha256: 'SHA256:aaaa',
	keyBase64: 'AAAA',
	trustedAtMs: 1700000000000,
	...over,
});

describe('parseKnownHosts', () => {
	test('parses a well-formed list', () => {
		const list = [entry(), entry({ algorithm: 'rsa-sha2-512' })];
		expect(parseKnownHosts(JSON.stringify(list))).toEqual(list);
	});

	test('returns [] on garbage JSON', () => {
		expect(parseKnownHosts('not json')).toEqual([]);
	});

	test('returns [] on non-array JSON', () => {
		expect(parseKnownHosts('{"host":"x"}')).toEqual([]);
	});

	test('drops malformed entries, keeps the rest', () => {
		const good = entry();
		const json = JSON.stringify([
			good,
			null,
			42,
			{ host: 'missing-the-rest.com' },
			{ ...good, port: 'not-a-number' },
		]);
		expect(parseKnownHosts(json)).toEqual([good]);
	});

	test('defaults a missing trustedAtMs to 0', () => {
		const { trustedAtMs: _omit, ...partial } = entry();
		expect(parseKnownHosts(JSON.stringify([partial]))).toEqual([
			{ ...partial, trustedAtMs: 0 },
		]);
	});
});

describe('evaluateHostKey', () => {
	const pinned = [entry()];

	test('trusted: same host/port/algorithm + same fingerprint', () => {
		expect(evaluateHostKey(pinned, entry())).toEqual({ kind: 'trusted' });
	});

	test('unknown: host never seen', () => {
		expect(evaluateHostKey(pinned, entry({ host: 'other.com' }))).toEqual({
			kind: 'unknown',
		});
	});

	test('unknown: same host, different port', () => {
		expect(evaluateHostKey(pinned, entry({ port: 2222 }))).toEqual({
			kind: 'unknown',
		});
	});

	test('unknown: known host but new algorithm (never a MITM signal)', () => {
		expect(
			evaluateHostKey(
				pinned,
				entry({ algorithm: 'rsa-sha2-512', fingerprintSha256: 'SHA256:bbbb' }),
			),
		).toEqual({ kind: 'unknown' });
	});

	test('changed: same algorithm, different fingerprint — reports the prior pin', () => {
		const verdict = evaluateHostKey(
			pinned,
			entry({ fingerprintSha256: 'SHA256:evil' }),
		);
		expect(verdict).toEqual({ kind: 'changed', prior: pinned[0]! });
	});
});

describe('upsertEntry', () => {
	test('appends a new (host, port, algorithm) target', () => {
		const rsa = entry({ algorithm: 'rsa-sha2-512' });
		expect(upsertEntry([entry()], rsa)).toEqual([entry(), rsa]);
	});

	test('replaces the same target (un-trusts the old key)', () => {
		const renewed = entry({ fingerprintSha256: 'SHA256:new', trustedAtMs: 2 });
		expect(upsertEntry([entry()], renewed)).toEqual([renewed]);
	});

	test('leaves other hosts alone', () => {
		const other = entry({ host: 'other.com' });
		const renewed = entry({ fingerprintSha256: 'SHA256:new' });
		expect(upsertEntry([other, entry()], renewed)).toEqual([other, renewed]);
	});
});

describe('removeHost', () => {
	test('removes every algorithm entry for host:port', () => {
		const rsa = entry({ algorithm: 'rsa-sha2-512' });
		const other = entry({ host: 'other.com' });
		expect(removeHost([entry(), rsa, other], 'example.com', 22)).toEqual([
			other,
		]);
	});

	test('same host on a different port survives', () => {
		const alt = entry({ port: 2222 });
		expect(removeHost([entry(), alt], 'example.com', 22)).toEqual([alt]);
	});
});

describe('hostPortLabel', () => {
	test('formats host:port', () => {
		expect(hostPortLabel('example.com', 22)).toBe('example.com:22');
	});
});
