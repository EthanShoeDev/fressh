import {
	RnRussh,
	type SshConnection,
	type SshShell,
} from '@fressh/react-native-uniffi-russh';

// Simple in-memory registry owned by JS to track active handles.
// Keyed by `${connectionId}:${channelId}`.

export type SessionKey = string;

export type StoredSession = {
	connection: SshConnection;
	shell: SshShell;
};

const sessions = new Map<SessionKey, StoredSession>();

export function makeSessionKey(
	connectionId: string,
	channelId: number,
): SessionKey {
	return `${connectionId}:${channelId}`;
}

export function registerSession(
	connection: SshConnection,
	shell: SshShell,
): SessionKey {
	const key = makeSessionKey(connection.connectionId, shell.channelId);
	sessions.set(key, { connection, shell });
	return key;
}

export function getSession(
	connectionId: string,
	channelId: number,
): StoredSession | undefined {
	return sessions.get(makeSessionKey(connectionId, channelId));
}

export function removeSession(connectionId: string, channelId: number): void {
	sessions.delete(makeSessionKey(connectionId, channelId));
}

export function listSessions(): StoredSession[] {
	return Array.from(sessions.values());
}

// Legacy list view expected shape
export type ShellWithConnection = StoredSession['shell'] & {
	connection: SshConnection;
};

export function listConnectionsWithShells(): (SshConnection & {
	shells: StoredSession['shell'][];
})[] {
	// Group shells by connection
	const byConn = new Map<string, { conn: SshConnection; shells: SshShell[] }>();
	for (const { connection, shell } of sessions.values()) {
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
}

// Convenience helpers for flows
export async function connectAndStart(
	details: Parameters<typeof RnRussh.connect>[0],
) {
	const conn = await RnRussh.connect(details);
	const shell = await conn.startShell({ pty: 'Xterm' });
	registerSession(conn, shell);
	return { conn, shell };
}

export async function closeShell(connectionId: string, channelId: number) {
	const sess = getSession(connectionId, channelId);
	if (!sess) return;
	await sess.shell.close();
	removeSession(connectionId, channelId);
}

export async function disconnectConnection(connectionId: string) {
	const remaining = Array.from(sessions.entries()).filter(
		([, v]) => v.connection.connectionId === connectionId,
	);
	for (const [key, sess] of remaining) {
		try {
			await sess.shell.close();
		} catch {}
		sessions.delete(key);
	}
	// Find one connection handle for this id to disconnect
	const conn = remaining[0]?.[1].connection;
	if (conn) {
		try {
			await conn.disconnect();
		} catch {}
	}
}
