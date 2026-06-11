import {
	addFresshEventListener,
	closeShell as fresshCloseShell,
	connect as fresshConnect,
	disconnect as fresshDisconnect,
	FresshEvent_Tags,
	resize as fresshResize,
	Security,
	sendData as fresshSendData,
	startShell as fresshStartShell,
	TerminalType,
	type ConnectionDetails,
	type FresshEvent,
} from '@fressh/react-native-terminal';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Match from 'effect/Match';
import * as Atom from 'effect/unstable/reactivity/Atom';
import { atomRegistry } from './atom-registry';
import { dismissHostKeyPrompt, handleHostKeyPending } from './host-keys';
import { preferences } from './preferences';
import { appRuntime } from './runtime';

export type StoreConnectionDetails = {
	host: string;
	port: number;
	username: string;
};

/**
 * App-side view-model over the flat id-keyed control plane. The native registry
 * (fressh-core) owns real lifetime; these objects just bundle the id + cached
 * details + bound calls so the screens keep their object-shaped ergonomics.
 */
export interface StoreConnection {
	connectionId: string;
	connectionDetails: StoreConnectionDetails;
	createdAtMs: number;
	disconnect: () => Promise<void>;
	startShell: (opts?: {
		cols?: number;
		rows?: number;
		/** Inject OSC 633 shell integration for this shell. Omit ⇒ native default
		 *  (on). Pass the effective global∧per-host value here. */
		shellIntegration?: boolean;
	}) => Promise<StoreShell>;
}

export interface StoreShell {
	shellId: string;
	connectionId: string;
	channelId: number;
	createdAtMs: number;
	pty: string;
	/** Optional user-set local name for this session (runtime-only, set via the
	 *  detail screen's long-press rename). Falls back to `pty` when unset. */
	label?: string;
	sendData: (data: ArrayBuffer) => Promise<void>;
	resize: (cols: number, rows: number) => Promise<void>;
	close: () => Promise<void>;
}

export type ConnectArgs = {
	host: string;
	port: number;
	username: string;
	security:
		| { type: 'password'; password: string }
		| { type: 'key'; privateKey: string };
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Live connections / shells by runtime id. `keepAlive`: the event plane writes
 * these whether or not any screen currently subscribes, so the registry must
 * never garbage-collect their state.
 */
export const sshConnectionsAtom = Atom.make<Record<string, StoreConnection>>(
	{},
).pipe(Atom.keepAlive);
export const sshShellsAtom = Atom.make<Record<string, StoreShell>>({}).pipe(
	Atom.keepAlive,
);

/** Fine-grained per-connection selection — `Object.is` dedupe means a
 *  subscriber only re-renders when ITS connection object changes. */
export const connectionAtom = Atom.family((connectionId: string) =>
	Atom.map(sshConnectionsAtom, (connections) => connections[connectionId]),
);

function channelIdFromShellId(shellId: string): number {
	const n = Number.parseInt(shellId.slice(shellId.lastIndexOf(':') + 1), 10);
	return Number.isNaN(n) ? 0 : n;
}

function makeShell(shellId: string, connectionId: string): StoreShell {
	return {
		shellId,
		connectionId,
		channelId: channelIdFromShellId(shellId),
		createdAtMs: appRuntime.runSync(Clock.currentTimeMillis),
		pty: 'xterm-256color',
		sendData: (data) => fresshSendData(shellId, data),
		resize: (cols, rows) => fresshResize(shellId, cols, rows),
		close: () => fresshCloseShell(shellId),
	};
}

function makeConnection(
	connectionId: string,
	details: StoreConnectionDetails,
): StoreConnection {
	return {
		connectionId,
		connectionDetails: details,
		createdAtMs: appRuntime.runSync(Clock.currentTimeMillis),
		disconnect: () => fresshDisconnect(connectionId),
		startShell: async (opts) => {
			const shellId = await fresshStartShell(connectionId, {
				term: TerminalType.Xterm256,
				cols: opts?.cols ?? DEFAULT_COLS,
				rows: opts?.rows ?? DEFAULT_ROWS,
				// Read at shell-creation time: scrollback is a control-plane,
				// creation-only knob (ring buffer allocated in fressh-core).
				scrollbackLines: preferences.terminalScrollback.get(),
				// undefined ⇒ native default (on); the connect flow passes the
				// effective global∧per-host value. See terminal-semantic-events.md.
				shellIntegration: opts?.shellIntegration,
			});
			const shell = makeShell(shellId, connectionId);
			atomRegistry.update(sshShellsAtom, (shells) => ({
				...shells,
				[shellId]: shell,
			}));
			return shell;
		},
	};
}

/** Open an SSH connection and register it in {@link sshConnectionsAtom}. */
export const connectSsh = Effect.fnUntraced(function* (args: ConnectArgs) {
	const security =
		args.security.type === 'password'
			? Security.Password.new({ password: args.security.password })
			: Security.Key.new({ privateKeyContent: args.security.privateKey });
	const details: ConnectionDetails = {
		host: args.host,
		port: args.port,
		username: args.username,
		security,
	};
	const connectionId = yield* Effect.tryPromise(() => fresshConnect(details));
	const connection = makeConnection(connectionId, {
		host: args.host,
		port: args.port,
		username: args.username,
	});
	yield* Effect.sync(() =>
		atomRegistry.update(sshConnectionsAtom, (connections) => ({
			...connections,
			[connectionId]: connection,
		})),
	);
	return connection;
});

/** Set (or clear, with '') a session's local name. Runtime-only. */
export function renameShell(shellId: string, label: string): void {
	atomRegistry.update(sshShellsAtom, (shells) => {
		const shell = shells[shellId];
		if (!shell) {
			return shells;
		}
		return { ...shells, [shellId]: { ...shell, label: label || undefined } };
	});
}

const onLifecycleEvent = Match.type<FresshEvent>().pipe(
	// TOFU verification: pinned key → silent accept; unknown/changed key →
	// the global <HostKeyPrompt/> asks the user. See lib/host-keys.ts.
	Match.discriminator('tag')(
		FresshEvent_Tags.HostKeyPending,
		Effect.fnUntraced(function* (event) {
			const { connectionId, info } = event.inner;
			yield* Effect.logInfo('host key pending', info.fingerprintSha256);
			yield* handleHostKeyPending(connectionId, info);
		}),
	),
	Match.discriminator('tag')(
		FresshEvent_Tags.ConnectionClosed,
		Effect.fnUntraced(function* (event) {
			const { connectionId } = event.inner;
			yield* Effect.logDebug('connection closed', connectionId);
			// If a trust prompt was parked on this connection, drop it — there is
			// nothing left to answer.
			yield* dismissHostKeyPrompt(connectionId);
			yield* Effect.sync(() => {
				atomRegistry.update(sshConnectionsAtom, (connections) => {
					const { [connectionId]: _omit, ...rest } = connections;
					return rest;
				});
				atomRegistry.update(sshShellsAtom, (shells) =>
					Object.fromEntries(
						Object.entries(shells).filter(
							([, shell]) => shell.connectionId !== connectionId,
						),
					),
				);
			});
		}),
	),
	Match.discriminator('tag')(
		FresshEvent_Tags.ShellClosed,
		Effect.fnUntraced(function* (event) {
			const { shellId } = event.inner;
			yield* Effect.logDebug('shell closed', shellId);
			yield* Effect.sync(() =>
				atomRegistry.update(sshShellsAtom, (shells) => {
					const { [shellId]: _omit, ...rest } = shells;
					return rest;
				}),
			);
		}),
	),
	// ConnectProgress (and the byte-stream-adjacent OSC tags) are consumed
	// elsewhere — the connect flow (query-fns) and terminal-semantics.
	Match.orElse(() => Effect.void),
);

// One global event subscription drives store lifecycle (§10 event plane). The
// byte stream never comes through here — only low-frequency lifecycle events.
addFresshEventListener((event) =>
	appRuntime.runSync(
		Effect.annotateLogs(onLifecycleEvent(event), { module: 'SshStore' }),
	),
);
