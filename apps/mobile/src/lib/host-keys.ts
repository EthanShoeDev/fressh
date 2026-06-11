import {
	respondToHostKey,
	type ServerPublicKeyInfo,
} from '@fressh/react-native-terminal';
import { useAtomValue } from '@effect/atom-react';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Atom from 'effect/unstable/reactivity/Atom';
import { useMemo } from 'react';
import { atomRegistry } from './atom-registry';
import {
	encodeKnownHosts,
	evaluateHostKey,
	type HostKeyVerdict,
	type KnownHostEntry,
	parseKnownHosts,
	removeHost,
	upsertEntry,
} from './known-hosts';
import { preferences } from './preferences';

/**
 * Host-key wiring — the MMKV-backed known-hosts store (as the {@link KnownHosts}
 * service) and the global trust prompt queue. `ssh-store.ts` routes every
 * `HostKeyPending` event here (replacing the old auto-accept); the globally
 * mounted `<HostKeyPrompt/>` renders the queue head and answers via
 * {@link resolveHostKeyPrompt}. The pure verdict logic lives in
 * `lib/known-hosts.ts`.
 *
 * Everything here returns Effects; callers at the React/event-plane boundary
 * run them through `appRuntime` (which provides {@link KnownHosts}).
 */

export class KnownHosts extends Context.Service<
	KnownHosts,
	{
		/** Pinned host keys, parsed from the `knownHosts` pref. */
		readonly entries: Effect.Effect<KnownHostEntry[]>;
		/** Verdict for a presented key against the pins. */
		evaluate(info: ServerPublicKeyInfo): Effect.Effect<HostKeyVerdict>;
		/** Pin (or re-pin) the presented key for its (host, port, algorithm). */
		trust(info: ServerPublicKeyInfo): Effect.Effect<void>;
		/** Forget every pinned key for host:port — the next connect re-prompts. */
		revoke(host: string, port: number): Effect.Effect<void>;
	}
>()('fressh/KnownHosts') {
	static readonly layer = Layer.sync(KnownHosts, () => {
		const read = () => parseKnownHosts(preferences.knownHosts.get());
		const write = (entries: KnownHostEntry[]) =>
			preferences.knownHosts.set(encodeKnownHosts(entries));
		return KnownHosts.of({
			entries: Effect.sync(read),
			evaluate: (info) => Effect.sync(() => evaluateHostKey(read(), info)),
			trust: (info) =>
				Effect.map(Clock.currentTimeMillis, (now) =>
					write(
						upsertEntry(read(), {
							host: info.host,
							port: info.port,
							algorithm: info.algorithm,
							fingerprintSha256: info.fingerprintSha256,
							keyBase64: info.keyBase64,
							trustedAtMs: now,
						}),
					),
				),
			revoke: (host, port) =>
				Effect.sync(() => write(removeHost(read(), host, port))),
		});
	});
}

/** Reactive list of pinned host keys (re-renders when the pref changes). */
export function useKnownHosts(): KnownHostEntry[] {
	const [raw] = preferences.knownHosts.useValue();
	return useMemo(() => parseKnownHosts(raw), [raw]);
}

/** Forget every pinned key for host:port (the Settings → Known hosts screen). */
export const revokeHost = Effect.fnUntraced(function* (
	host: string,
	port: number,
) {
	const knownHosts = yield* KnownHosts;
	yield* knownHosts.revoke(host, port);
});

// ---------------------------------------------------------------------------
// Prompt queue. Concurrent connects (connect form + the Commands-tab one-off
// runner) can park more than one connection on a pending key at once; the UI
// renders `queue[0]` and answering/dismissing the head reveals the next.

export interface PendingHostKey {
	connectionId: string;
	info: ServerPublicKeyInfo;
	verdict: 'unknown' | 'changed';
	/** The pin the presented key conflicts with (set when verdict is 'changed'). */
	prior?: KnownHostEntry;
}

/** The pending-prompt queue. `keepAlive`: the event plane enqueues whether or
 *  not the prompt UI is currently subscribed. */
export const hostKeyPromptQueueAtom = Atom.make<PendingHostKey[]>([]).pipe(
	Atom.keepAlive,
);

/** Head of the queue — what the globally mounted `<HostKeyPrompt/>` renders. */
export const hostKeyPromptHeadAtom = Atom.map(
	hostKeyPromptQueueAtom,
	(queue) => queue[0],
);

const hasPending = (queue: PendingHostKey[]) => queue.length > 0;

/**
 * True while a trust prompt is waiting for the user. RN modals that can be up
 * during a connect (the connect form's ConnectingOverlay, BottomSheet) hide
 * themselves on this — iOS presents one modal at a time, so a presented modal
 * would otherwise sit on top of (or outright block) the in-tree prompt.
 */
export function useHostKeyPromptPending(): boolean {
	return useAtomValue(hostKeyPromptQueueAtom, hasPending);
}

function dequeue(connectionId: string) {
	atomRegistry.update(hostKeyPromptQueueAtom, (queue) =>
		queue.filter((p) => p.connectionId !== connectionId),
	);
}

class RespondToHostKeyError extends Data.TaggedError('RespondToHostKeyError')<{
	cause: unknown;
}> {}

/** The connection may have died while the prompt was up — the native side then
 *  has nothing parked under this id, so the sync uniffi call can throw. */
const respond = (connectionId: string, accept: boolean) =>
	Effect.try({
		try: () => respondToHostKey(connectionId, accept),
		catch: (cause) => new RespondToHostKeyError({ cause }),
	}).pipe(
		Effect.catch((error) =>
			Effect.logWarning('respondToHostKey failed (connection gone?)', error),
		),
	);

/** Decide a `HostKeyPending` event: pinned key matches → accept silently (the
 *  friction-free common case); unknown/changed → park it on the prompt queue
 *  for the user. Run from ssh-store's global event listener. */
export const handleHostKeyPending = Effect.fnUntraced(
	function* (connectionId: string, info: ServerPublicKeyInfo) {
		const knownHosts = yield* KnownHosts;
		const verdict = yield* knownHosts.evaluate(info);
		if (verdict.kind === 'trusted') {
			yield* Effect.logDebug(
				'host key matches pin, accepting',
				info.fingerprintSha256,
			);
			yield* respond(connectionId, true);
			return;
		}
		yield* Effect.logInfo(
			`host key ${verdict.kind}, prompting`,
			info.fingerprintSha256,
		);
		yield* Effect.sync(() =>
			atomRegistry.update(hostKeyPromptQueueAtom, (queue) =>
				queue.some((p) => p.connectionId === connectionId)
					? queue
					: [
							...queue,
							{
								connectionId,
								info,
								verdict: verdict.kind,
								prior: verdict.kind === 'changed' ? verdict.prior : undefined,
							},
						],
			),
		);
	},
	Effect.annotateLogs({ module: 'HostKeys' }),
);

/** Answer the prompt for a parked connection. Pins the key BEFORE responding
 *  on accept, so a fast reconnect can't race a re-prompt. */
export const resolveHostKeyPrompt = Effect.fnUntraced(
	function* (connectionId: string, accept: boolean) {
		const pending = yield* Effect.sync(() =>
			atomRegistry.modify(hostKeyPromptQueueAtom, (queue) => [
				queue.find((p) => p.connectionId === connectionId),
				queue.filter((p) => p.connectionId !== connectionId),
			]),
		);
		if (!pending) {
			return;
		}
		if (accept) {
			const knownHosts = yield* KnownHosts;
			yield* knownHosts.trust(pending.info);
		}
		yield* respond(connectionId, accept);
	},
	Effect.annotateLogs({ module: 'HostKeys' }),
);

/** Drop a queued prompt without answering — the connection closed underneath
 *  it. Run from ssh-store's ConnectionClosed case. */
export const dismissHostKeyPrompt = (connectionId: string) =>
	Effect.sync(() => dequeue(connectionId));
