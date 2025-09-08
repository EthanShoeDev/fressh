import SSHClient from '@dylankenneally/react-native-ssh-sftp'
import uuid from 'react-native-uuid'

export type SSHConn = {
	client: SSHClient
	sessionId: string
	createdAt: Date
}

const sshConnections = new Map<string, SSHConn>()

function addSession(params: { client: SSHClient }) {
	const sessionId = uuid.v4()
	const createdAt = new Date()
	const sshConn: SSHConn = {
		client: params.client,
		sessionId,
		createdAt,
	}
	sshConnections.set(sessionId, sshConn)
	return sshConn
}

function getSession(params: { sessionId: string }) {
	const sshConn = sshConnections.get(params.sessionId)
	if (!sshConn) throw new Error('Session not found')
	return sshConn
}

function removeAndDisconnectSession(params: { sessionId: string }) {
	const sshConn = getSession(params)
	// sshConn.client.closeShell()
	sshConn.client.disconnect()
	sshConnections.delete(params.sessionId)
}

export const sshConnectionManager = {
	addSession,
	getSession,
	removeAndDisconnectSession,
}
