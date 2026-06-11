import {
	respondToHostKey,
	type ServerPublicKeyInfo,
} from '@fressh/react-native-terminal';
import { useMemo } from 'react';
import { create } from 'zustand';
import {
	evaluateHostKey,
	type KnownHostEntry,
	parseKnownHosts,
	removeHost,
	upsertEntry,
} from './known-hosts';
import { rootLogger } from './logger';
import { preferences } from './preferences';

const logger = rootLogger.extend('HostKeys');

/**
 * Host-key wiring — the MMKV-backed known-hosts CRUD and the global trust
 * prompt queue. `ssh-store.ts` routes every `HostKeyPending` event here
 * (replacing the old auto-accept); the globally mounted `<HostKeyPrompt/>`
 * renders the queue head and answers via `resolveHostKeyPrompt`. The pure
 * verdict logic lives in `lib/known-hosts.ts`.
 */

// ---------------------------------------------------------------------------
// Known-hosts CRUD over the `knownHosts` pref (presets.ts pattern).

/** Read the pinned host keys imperatively (outside React). */
function getKnownHosts(): KnownHostEntry[] {
	return parseKnownHosts(preferences.knownHosts.get());
}

function save(entries: KnownHostEntry[]) {
	preferences.knownHosts.set(JSON.stringify(entries));
}

/** Reactive list of pinned host keys (re-renders when the pref changes). */
export function useKnownHosts(): KnownHostEntry[] {
	const [raw] = preferences.knownHosts.useValue();
	return useMemo(() => parseKnownHosts(raw), [raw]);
}

/** Pin (or re-pin) the presented key for its (host, port, algorithm). */
function trustHostKey(info: ServerPublicKeyInfo): void {
	save(
		upsertEntry(getKnownHosts(), {
			host: info.host,
			port: info.port,
			algorithm: info.algorithm,
			fingerprintSha256: info.fingerprintSha256,
			keyBase64: info.keyBase64,
			trustedAtMs: Date.now(),
		}),
	);
}

/** Forget every pinned key for host:port — the next connect re-prompts. */
export function revokeHost(host: string, port: number): void {
	save(removeHost(getKnownHosts(), host, port));
}

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

export const useHostKeyPromptStore = create<{ queue: PendingHostKey[] }>(
	() => ({ queue: [] }),
);

/**
 * True while a trust prompt is waiting for the user. RN modals that can be up
 * during a connect (the connect form's ConnectingOverlay, BottomSheet) hide
 * themselves on this — iOS presents one modal at a time, so a presented modal
 * would otherwise sit on top of (or outright block) the in-tree prompt.
 */
export function useHostKeyPromptPending(): boolean {
	return useHostKeyPromptStore((s) => s.queue.length > 0);
}

function dequeue(connectionId: string) {
	useHostKeyPromptStore.setState((s) => ({
		queue: s.queue.filter((p) => p.connectionId !== connectionId),
	}));
}

/** The connection may have died while the prompt was up — the native side then
 *  has nothing parked under this id, so the sync uniffi call can throw. */
function respond(connectionId: string, accept: boolean) {
	try {
		respondToHostKey(connectionId, accept);
	} catch (error) {
		logger.warn('respondToHostKey failed (connection gone?)', error);
	}
}

/** Decide a `HostKeyPending` event: pinned key matches → accept silently (the
 *  friction-free common case); unknown/changed → park it on the prompt queue
 *  for the user. Called from ssh-store's global event listener. */
export function handleHostKeyPending(
	connectionId: string,
	info: ServerPublicKeyInfo,
): void {
	const verdict = evaluateHostKey(getKnownHosts(), info);
	if (verdict.kind === 'trusted') {
		logger.debug('host key matches pin, accepting', info.fingerprintSha256);
		respond(connectionId, true);
		return;
	}
	logger.info(`host key ${verdict.kind}, prompting`, info.fingerprintSha256);
	useHostKeyPromptStore.setState((s) =>
		s.queue.some((p) => p.connectionId === connectionId)
			? s
			: {
					queue: [
						...s.queue,
						{
							connectionId,
							info,
							verdict: verdict.kind,
							prior: verdict.kind === 'changed' ? verdict.prior : undefined,
						},
					],
				},
	);
}

/** Answer the prompt for a parked connection. Pins the key BEFORE responding
 *  on accept, so a fast reconnect can't race a re-prompt. */
export function resolveHostKeyPrompt(
	connectionId: string,
	accept: boolean,
): void {
	const pending = useHostKeyPromptStore
		.getState()
		.queue.find((p) => p.connectionId === connectionId);
	dequeue(connectionId);
	if (!pending) {
		return;
	}
	if (accept) {
		trustHostKey(pending.info);
	}
	respond(connectionId, accept);
}

/** Drop a queued prompt without answering — the connection closed underneath
 *  it. Called from ssh-store's ConnectionClosed case. */
export function dismissHostKeyPrompt(connectionId: string): void {
	dequeue(connectionId);
}
