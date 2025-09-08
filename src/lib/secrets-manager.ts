import SSHClient from '@dylankenneally/react-native-ssh-sftp'
import { queryOptions } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import * as z from 'zod'
import { queryClient } from './utils'

const keys = {
	storagePrefix: 'privateKey_',
	manifestKey: 'privateKeysManifest',
} as const

const keyManifestSchema = z.object({
	manifestVersion: z.number().default(1),
	keys: z.array(
		z.object({
			id: z.string(),
			priority: z.number(),
			createdAt: z.date(),
		}),
	),
})

async function getKeyManifest() {
	const rawManifest = await SecureStore.getItemAsync(keys.manifestKey)
	const manifest = rawManifest
		? JSON.parse(rawManifest)
		: {
				manifestVersion: 1,
				keys: [],
			}
	return keyManifestSchema.parse(manifest)
}

async function savePrivateKey(params: {
	keyId: string
	privateKey: string
	priority: number
}) {
	const manifest = await getKeyManifest()

	const existingKey = manifest.keys.find((key) => key.id === params.keyId)

	if (existingKey) throw new Error('Key already exists')

	const newKey = {
		id: params.keyId,
		priority: params.priority,
		createdAt: new Date(),
	}

	manifest.keys.push(newKey)
	await SecureStore.setItemAsync(
		`${keys.storagePrefix}${params.keyId}`,
		params.privateKey,
	)
	await SecureStore.setItemAsync(keys.manifestKey, JSON.stringify(manifest))
	queryClient.invalidateQueries({ queryKey: [keyQueryKey] })
}

async function getPrivateKey(keyId: string) {
	const manifest = await getKeyManifest()
	const key = manifest.keys.find((key) => key.id === keyId)
	if (!key) throw new Error('Key not found')
	const privateKey = await SecureStore.getItemAsync(
		`${keys.storagePrefix}${keyId}`,
	)
	if (!privateKey) throw new Error('Key not found')
	return {
		...key,
		privateKey,
	}
}

async function deletePrivateKey(keyId: string) {
	const manifest = await getKeyManifest()
	const key = manifest.keys.find((key) => key.id === keyId)
	if (!key) throw new Error('Key not found')
	manifest.keys = manifest.keys.filter((key) => key.id !== keyId)
	await SecureStore.setItemAsync(keys.manifestKey, JSON.stringify(manifest))
	await SecureStore.deleteItemAsync(`${keys.storagePrefix}${keyId}`)
	queryClient.invalidateQueries({ queryKey: [keyQueryKey] })
}

const connections = {
	storagePrefix: 'connection_',
	manifestKey: 'connectionsManifest',
} as const

const connectionsManifestSchema = z.object({
	manifestVersion: z.number().default(1),
	connections: z.array(
		z.object({
			id: z.string(),
			priority: z.number(),
			createdAt: z.date(),
			modifiedAt: z.date(),
		}),
	),
})

export const connectionDetailsSchema = z.object({
	host: z.string().min(1),
	port: z.number().min(1),
	username: z.string().min(1),
	security: z.discriminatedUnion('type', [
		z.object({
			type: z.literal('password'),
			password: z.string().min(1),
		}),
		z.object({
			type: z.literal('key'),
			keyId: z.string().min(1),
		}),
	]),
})

export type ConnectionDetails = z.infer<typeof connectionDetailsSchema>

async function getConnectionManifest() {
	const rawManifest = await SecureStore.getItemAsync(connections.manifestKey)
	const manifest = rawManifest
		? JSON.parse(rawManifest)
		: {
				manifestVersion: 1,
				connections: [],
			}
	return connectionsManifestSchema.parse(manifest)
}

async function upsertConnection(params: {
	id: string
	details: ConnectionDetails
	priority: number
}) {
	const manifest = await getConnectionManifest()
	const existingConnection = manifest.connections.find(
		(connection) => connection.id === params.id,
	)

	const newConnection = existingConnection
		? {
				...existingConnection,
				priority: params.priority,
				modifiedAt: new Date(),
			}
		: {
				id: params.id,
				priority: params.priority,
				createdAt: new Date(),
				modifiedAt: new Date(),
			}

	await SecureStore.setItemAsync(
		connections.manifestKey,
		JSON.stringify(manifest),
	)
	await SecureStore.setItemAsync(
		`${connections.storagePrefix}${params.id}`,
		JSON.stringify(params.details),
	)
	queryClient.invalidateQueries({ queryKey: [connectionQueryKey] })
	return existingConnection ?? newConnection
}

async function deleteConnection(id: string) {
	const manifest = await getConnectionManifest()
	const connection = manifest.connections.find(
		(connection) => connection.id === id,
	)
	if (!connection) throw new Error('Connection not found')
	manifest.connections = manifest.connections.filter(
		(connection) => connection.id !== id,
	)
	await SecureStore.setItemAsync(
		connections.manifestKey,
		JSON.stringify(manifest),
	)
	await SecureStore.deleteItemAsync(`${connections.storagePrefix}${id}`)
	queryClient.invalidateQueries({ queryKey: [connectionQueryKey] })
}

async function getConnection(id: string) {
	const manifest = await getConnectionManifest()
	const connection = manifest.connections.find(
		(connection) => connection.id === id,
	)
	if (!connection) throw new Error('Connection not found')
	const detailsString = await SecureStore.getItemAsync(
		`${connections.storagePrefix}${id}`,
	)
	if (!detailsString) throw new Error('Connection details not found')
	const detailsJson = JSON.parse(detailsString)
	const details = connectionDetailsSchema.parse(detailsJson)
	return { ...connection, details }
}

const connectionQueryKey = 'connections'

const listConnectionsQueryOptions = queryOptions({
	queryKey: [connectionQueryKey],
	queryFn: async () => {
		const manifest = await getConnectionManifest()
		const firstConnectionMeta = manifest.connections[0]
		const firstConnection = firstConnectionMeta
			? await getConnection(firstConnectionMeta.id)
			: null

		return {
			manifest,
			firstConnection,
		}
	},
})

const getConnectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: [connectionQueryKey, id],
		queryFn: () => getConnection(id),
	})

const keyQueryKey = 'keys'

const listKeysQueryOptions = queryOptions({
	queryKey: [keyQueryKey],
	queryFn: getKeyManifest,
})

// https://github.com/dylankenneally/react-native-ssh-sftp/blob/ea55436d8d40378a8f9dabb95b463739ffb219fa/android/src/main/java/me/keeex/rnssh/RNSshClientModule.java#L101-L119
export type SshPrivateKeyType = 'dsa' | 'rsa' | 'ecdsa' | 'ed25519' | 'ed448'
async function generateKeyPair(params: {
	type: SshPrivateKeyType
	passphrase?: string
	keySize?: number
	comment?: string
}) {
	const keyPair = await SSHClient.generateKeyPair(
		params.type,
		params.passphrase,
		params.keySize,
		params.comment,
	)
	return keyPair
}

export const secretsManager = {
	keys: {
		utils: {
			getKeyManifest,
			savePrivateKey,
			getPrivateKey,
			deletePrivateKey,
			generateKeyPair,
		},
		query: {
			list: listKeysQueryOptions,
		},
	},
	connections: {
		utils: {
			upsertConnection,
			deleteConnection,
		},
		query: {
			list: listConnectionsQueryOptions,
			get: getConnectionQueryOptions,
		},
	},
}
