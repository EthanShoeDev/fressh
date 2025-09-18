import { RnRussh } from '@fressh/react-native-uniffi-russh';
import {
	queryOptions,
	useMutation,
	useQueryClient,
	type QueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { secretsManager, type InputConnectionDetails } from './secrets-manager';
import { useSshStore, toSessionStatus, type SessionKey } from './ssh-store';
import { AbortSignalTimeout } from './utils';

export const useSshConnMutation = () => {
	const router = useRouter();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (connectionDetails: InputConnectionDetails) => {
			try {
				console.log('Connecting to SSH server...');
				const sshConnection = await RnRussh.connect({
					host: connectionDetails.host,
					port: connectionDetails.port,
					username: connectionDetails.username,
					security:
						connectionDetails.security.type === 'password'
							? {
									type: 'password',
									password: connectionDetails.security.password,
								}
							: { type: 'key', privateKey: 'TODO' },
					onStatusChange: (status) => {
						console.log('SSH connection status', status);
					},
					abortSignal: AbortSignalTimeout(5_000),
				});

				await secretsManager.connections.utils.upsertConnection({
					id: 'default',
					details: connectionDetails,
					priority: 0,
				});
				// Capture status events to Zustand after session is known.
				let keyRef: SessionKey | null = null;
				const shellInterface = await sshConnection.startShell({
					pty: 'Xterm',
					onStatusChange: (status) => {
						if (keyRef)
							useSshStore.getState().setStatus(keyRef, toSessionStatus(status));
						console.log('SSH shell status', status);
					},
					abortSignal: AbortSignalTimeout(5_000),
				});

				const channelId = shellInterface.channelId;
				const connectionId = `${sshConnection.connectionDetails.username}@${sshConnection.connectionDetails.host}:${sshConnection.connectionDetails.port}|${Math.floor(sshConnection.createdAtMs)}`;
				console.log('Connected to SSH server', connectionId, channelId);

				// Track in Zustand store
				keyRef = useSshStore
					.getState()
					.addSession(sshConnection, shellInterface);

				await queryClient.invalidateQueries({
					queryKey: listSshShellsQueryOptions.queryKey,
				});
				router.push({
					pathname: '/shell/detail',
					params: {
						connectionId: connectionId,
						channelId: String(channelId),
					},
				});
			} catch (error) {
				console.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};

export const listSshShellsQueryOptions = queryOptions({
	queryKey: ['ssh-shells'],
	queryFn: () => useSshStore.getState().listConnectionsWithShells(),
});

export type ShellWithConnection = (ReturnType<
	typeof useSshStore.getState
>['listConnectionsWithShells'] extends () => infer R
	? R
	: never)[number]['shells'][number] & {
	connection: (ReturnType<
		typeof useSshStore.getState
	>['listConnectionsWithShells'] extends () => infer R
		? R
		: never)[number];
};

export const closeSshShellAndInvalidateQuery = async (params: {
	channelId: number;
	connectionId: string;
	queryClient: QueryClient;
}) => {
	const currentActiveShells = useSshStore
		.getState()
		.listConnectionsWithShells();
	const connection = currentActiveShells.find(
		(c) => c.connectionId === params.connectionId,
	);
	if (!connection) throw new Error('Connection not found');
	const shell = connection.shells.find((s) => s.channelId === params.channelId);
	if (!shell) throw new Error('Shell not found');
	await shell.close();
	await params.queryClient.invalidateQueries({
		queryKey: listSshShellsQueryOptions.queryKey,
	});
};

export const disconnectSshConnectionAndInvalidateQuery = async (params: {
	connectionId: string;
	queryClient: QueryClient;
}) => {
	const currentActiveShells = useSshStore
		.getState()
		.listConnectionsWithShells();
	const connection = currentActiveShells.find(
		(c) => c.connectionId === params.connectionId,
	);
	if (!connection) throw new Error('Connection not found');
	await connection.disconnect();
	await params.queryClient.invalidateQueries({
		queryKey: listSshShellsQueryOptions.queryKey,
	});
};
