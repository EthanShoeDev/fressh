import {
	type SshConnection,
	type SshShell,
	type SshConnectionStatus,
} from '@fressh/react-native-uniffi-russh';
import { create } from 'zustand';

export type SessionKey = string;
export const makeSessionKey = (connectionId: string, channelId: number) =>
	`${connectionId}:${channelId}` as const;

export type SessionStatus = 'connecting' | 'connected' | 'disconnected';

export interface StoredSession {
	connection: SshConnection;
	shell: SshShell;
	status: SessionStatus;
}

interface SshStoreState {
	sessions: Record<SessionKey, StoredSession>;
	addSession: (conn: SshConnection, shell: SshShell) => SessionKey;
	removeSession: (key: SessionKey) => void;
	setStatus: (key: SessionKey, status: SessionStatus) => void;
	getByKey: (key: SessionKey) => StoredSession | undefined;
	listConnectionsWithShells: () => (SshConnection & { shells: SshShell[] })[];
}

export const useSshStore = create<SshStoreState>((set, get) => ({
	sessions: {},
	addSession: (conn, shell) => {
		const key = makeSessionKey(conn.connectionId, shell.channelId);
		set((s) => ({
			sessions: {
				...s.sessions,
				[key]: { connection: conn, shell, status: 'connected' },
			},
		}));
		return key;
	},
	removeSession: (key) => {
		set((s) => {
			const { [key]: _omit, ...rest } = s.sessions;
			return { sessions: rest };
		});
	},
	setStatus: (key, status) => {
		set((s) =>
			s.sessions[key]
				? { sessions: { ...s.sessions, [key]: { ...s.sessions[key], status } } }
				: s,
		);
	},
	getByKey: (key) => get().sessions[key],
	listConnectionsWithShells: () => {
		const byConn = new Map<
			string,
			{ conn: SshConnection; shells: SshShell[] }
		>();
		for (const { connection, shell } of Object.values(get().sessions)) {
			const g = byConn.get(connection.connectionId) ?? {
				conn: connection,
				shells: [],
			};
			g.shells.push(shell);
			byConn.set(connection.connectionId, g);
		}
		return Array.from(byConn.values()).map(({ conn, shells }) => ({
			...conn,
			shells,
		}));
	},
}));

export function toSessionStatus(status: SshConnectionStatus): SessionStatus {
	switch (status) {
		case 'shellConnecting':
			return 'connecting';
		case 'shellConnected':
			return 'connected';
		case 'shellDisconnected':
			return 'disconnected';
		default:
			return 'connected';
	}
}
