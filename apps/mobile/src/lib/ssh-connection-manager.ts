import { type SshConnection } from '@fressh/react-native-uniffi-russh';
import * as Crypto from 'expo-crypto';


export type SSHConn = {
	client: SshConnection;
	sessionId: string;
	createdAt: Date;
};

const sshConnections = new Map<string, SSHConn>();

function addSession(params: { client: SshConnection }) {
	const sessionId = Crypto.randomUUID();
	const createdAt = new Date();
	const sshConn: SSHConn = {
		client: params.client,
		sessionId,
		createdAt,
	};
	sshConnections.set(sessionId, sshConn);
	return sshConn;
}

function getSession(params: { sessionId: string }) {
	const sshConn = sshConnections.get(params.sessionId);
	if (!sshConn) throw new Error('Session not found');
	return sshConn;
}

async function removeAndDisconnectSession(params: { sessionId: string }) {
	const sshConn = getSession(params);
	await sshConn.client.disconnect();
	sshConnections.delete(params.sessionId);
}

export const sshConnectionManager = {
	addSession,
	getSession,
	removeAndDisconnectSession,
};
