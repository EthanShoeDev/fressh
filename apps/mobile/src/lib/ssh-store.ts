import {
	addFresshEventListener,
	closeShell as fresshCloseShell,
	connect as fresshConnect,
	disconnect as fresshDisconnect,
	FresshEvent_Tags,
	resize as fresshResize,
	respondToHostKey,
	Security,
	sendData as fresshSendData,
	startShell as fresshStartShell,
	TerminalType,
	type ConnectionDetails,
} from '@fressh/react-native-terminal';
import { create } from 'zustand';
import { rootLogger } from './logger';
import { preferences } from './preferences';

const logger = rootLogger.extend('SshStore');

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
	startShell: (opts?: { cols?: number; rows?: number }) => Promise<StoreShell>;
}

export interface StoreShell {
	shellId: string;
	connectionId: string;
	channelId: number;
	createdAtMs: number;
	pty: string;
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

interface SshRegistryStore {
	connections: Record<string, StoreConnection>;
	shells: Record<string, StoreShell>;
	connect: (args: ConnectArgs) => Promise<StoreConnection>;
}

function channelIdFromShellId(shellId: string): number {
	const n = Number.parseInt(shellId.slice(shellId.lastIndexOf(':') + 1), 10);
	return Number.isNaN(n) ? 0 : n;
}

export const useSshStore = create<SshRegistryStore>((set) => {
	function makeShell(shellId: string, connectionId: string): StoreShell {
		return {
			shellId,
			connectionId,
			channelId: channelIdFromShellId(shellId),
			createdAtMs: Date.now(),
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
			createdAtMs: Date.now(),
			disconnect: () => fresshDisconnect(connectionId),
			startShell: async (opts) => {
				const shellId = await fresshStartShell(connectionId, {
					term: TerminalType.Xterm256,
					cols: opts?.cols ?? DEFAULT_COLS,
					rows: opts?.rows ?? DEFAULT_ROWS,
					// Read at shell-creation time: scrollback is a control-plane,
						// creation-only knob (ring buffer allocated in fressh-core).
						scrollbackLines: preferences.terminalScrollback.get(),
				});
				const shell = makeShell(shellId, connectionId);
				set((s) => ({ shells: { ...s.shells, [shellId]: shell } }));
				return shell;
			},
		};
	}

	return {
		connections: {},
		shells: {},
		connect: async (args) => {
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
			const connectionId = await fresshConnect(details);
			const connection = makeConnection(connectionId, {
				host: args.host,
				port: args.port,
				username: args.username,
			});
			set((s) => ({
				connections: { ...s.connections, [connectionId]: connection },
			}));
			return connection;
		},
	};
});

// One global event subscription drives store lifecycle (§10 event plane). The
// byte stream never comes through here — only low-frequency lifecycle events.
addFresshEventListener((event) => {
	switch (event.tag) {
		case FresshEvent_Tags.HostKeyPending: {
			// Auto-accept (preserves the previous onServerKey -> true behavior).
			// TODO: surface a trust prompt and call respondToHostKey accordingly.
			logger.info(
				'host key pending (auto-accept)',
				event.inner.info.fingerprintSha256,
			);
			respondToHostKey(event.inner.connectionId, true);
			break;
		}
		case FresshEvent_Tags.ConnectionClosed: {
			const { connectionId } = event.inner;
			logger.debug('connection closed', connectionId);
			useSshStore.setState((s) => {
				const { [connectionId]: _omit, ...connections } = s.connections;
				const shells = Object.fromEntries(
					Object.entries(s.shells).filter(
						([, shell]) => shell.connectionId !== connectionId,
					),
				);
				return { connections, shells };
			});
			break;
		}
		case FresshEvent_Tags.ShellClosed: {
			const { shellId } = event.inner;
			logger.debug('shell closed', shellId);
			useSshStore.setState((s) => {
				const { [shellId]: _omit, ...shells } = s.shells;
				return { shells };
			});
			break;
		}
		default:
			// ConnectProgress is consumed by the connect flow (query-fns).
			break;
	}
});
