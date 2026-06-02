/**
 * Control plane (§10): the JS-facing SSH API. Thin wrappers over the binding
 * shim (uniffi now, craby later) which forwards to fressh-core. Async + rare —
 * the byte stream NEVER crosses here (it stays native, feeding `Term`).
 *
 * Agnostic FFI surface this models (FresshControlSpec, §10):
 *   connect(opts) -> connectionId
 *   disconnect(connectionId)
 *   respondToHostKey(connectionId, accept)
 *   startShell(connectionId, opts) -> shellId
 *   sendData(shellId, data: ArrayBuffer)
 *   resize(shellId, cols, rows)
 *   closeShell(shellId)
 *   generateKeyPair(type) / validatePrivateKey(pem)
 * Events (one-way sink): connectProgress | hostKeyPending | connectionClosed | shellClosed
 */

// TODO(scaffold): import the generated uniffi shim bindings and re-export typed
// wrappers + a small zustand store / react-query hooks (useSshConnect) that pin
// session ids (NOT native handles — the registry owns lifetime, §7/§9).

export type ConnectionId = string;
export type ShellId = string;

// Placeholder types — fleshed out against the generated shim.
export type ConnectOptions = {
	host: string;
	port: number;
	username: string;
	// TODO(scaffold): auth (password | privateKey), known-host policy, etc.
};

export type ShellOptions = {
	cols: number;
	rows: number;
	// TODO(scaffold): term, env, initial command.
};
