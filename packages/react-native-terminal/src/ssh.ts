/**
 * Control plane (§10): the JS-facing SSH API. Thin, typed wrappers over the
 * generated uniffi shim (`./generated/shim_uniffi`), which forwards to
 * `fressh-core`. Async + rare — the byte stream NEVER crosses here (it stays
 * native, feeding the durable `Term`; the view reads it by `shellId`).
 *
 * Lifetime is the registry's (§7/§9): these calls pass string ids, never native
 * handles, so a session survives JS GC / view unmount until an explicit
 * `disconnect`/`closeShell`.
 */

import {
	closeShell as _closeShell,
	connect as _connect,
	disconnect as _disconnect,
	generateKeyPair as _generateKeyPair,
	resize as _resize,
	respondToHostKey as _respondToHostKey,
	sendData as _sendData,
	setEventListener as _setEventListener,
	startShell as _startShell,
	validatePrivateKey as _validatePrivateKey,
	type ConnectionDetails,
	type FresshEvent,
	FresshEvent_Tags,
	type FresshEventListener,
	KeyType,
	type ServerPublicKeyInfo,
	Security,
	type ShellOptions,
	SshConnectionProgressEvent,
	TerminalType,
} from './generated/shim_uniffi';

// Re-export the generated enums/factories (values) the app needs to construct
// inputs and match events.
export { FresshEvent_Tags, KeyType, Security, SshConnectionProgressEvent, TerminalType };
// Records + the event union are plain object types — re-export as types.
export type { ConnectionDetails, FresshEvent, FresshEventListener, ServerPublicKeyInfo, ShellOptions };

export type ConnectionId = string;
export type ShellId = string;

// ─────────────────────────── control plane ───────────────────────────

/** Connect + authenticate. Resolves to a `connectionId`. A `HostKeyPending`
 *  event fires mid-handshake — answer it with {@link respondToHostKey}. */
export const connect = (details: ConnectionDetails): Promise<ConnectionId> =>
	_connect(details);

export const disconnect = (connectionId: ConnectionId): Promise<void> =>
	_disconnect(connectionId);

export const respondToHostKey = (connectionId: ConnectionId, accept: boolean): void =>
	_respondToHostKey(connectionId, accept);

/** Open a PTY + shell. Resolves to a `shellId` — render it with
 *  `<Terminal shellId={shellId} />`. */
export const startShell = (
	connectionId: ConnectionId,
	options: ShellOptions,
): Promise<ShellId> => _startShell(connectionId, options);

/** Send user input (stdin). Also reachable on the render plane (the view forwards
 *  key/IME input straight to native), so most apps won't call this directly. */
export const sendData = (shellId: ShellId, data: ArrayBuffer): Promise<void> =>
	_sendData(shellId, data);

export const resize = (shellId: ShellId, cols: number, rows: number): Promise<void> =>
	_resize(shellId, cols, rows);

export const closeShell = (shellId: ShellId): Promise<void> => _closeShell(shellId);

export const generateKeyPair = (keyType: KeyType): string => _generateKeyPair(keyType);

export const validatePrivateKey = (pem: string): string => _validatePrivateKey(pem);

// ─────────────────────────── event plane (one-way) ───────────────────────────

export type FresshEventCallback = (event: FresshEvent) => void;

// uniffi accepts ONE listener; register a single fan-out and dispatch to many JS
// subscribers so the app can have independent listeners (connect flow, per-shell
// close handlers, host-key prompts) without clobbering one another.
const subscribers = new Set<FresshEventCallback>();
let installed = false;

function ensureInstalled() {
	if (installed) return;
	installed = true;
	const listener: FresshEventListener = {
		onEvent(event) {
			for (const cb of [...subscribers]) cb(event);
		},
	};
	_setEventListener(listener);
}

/** Subscribe to the low-frequency event stream (progress, host-key, closed).
 *  Returns an unsubscribe fn. */
export function addFresshEventListener(cb: FresshEventCallback): () => void {
	ensureInstalled();
	subscribers.add(cb);
	return () => {
		subscribers.delete(cb);
	};
}
