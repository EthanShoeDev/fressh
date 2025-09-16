import {
	RnRussh,
	type SshConnection,
	type SshShellSession,
} from '@fressh/react-native-uniffi-russh';
import {
	queryOptions,
	useMutation,
	useQueryClient,
	type QueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { secretsManager, type InputConnectionDetails } from './secrets-manager';
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
				const shellInterface = await sshConnection.startShell({
					pty: 'Xterm',
					onStatusChange: (status) => {
						console.log('SSH shell status', status);
					},
					abortSignal: AbortSignalTimeout(5_000),
				});

				const channelId = shellInterface.channelId as number;
				const connectionId =
					sshConnection.connectionId ??
					`${sshConnection.connectionDetails.username}@${sshConnection.connectionDetails.host}:${sshConnection.connectionDetails.port}|${Math.floor(sshConnection.createdAtMs)}`;
				console.log('Connected to SSH server', connectionId, channelId);

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
	queryFn: () => RnRussh.listSshConnectionsWithShells(),
});

export type ShellWithConnection = SshShellSession & {
	connection: SshConnection;
};

export const closeSshShellAndInvalidateQuery = async (params: {
	channelId: number;
	connectionId: string;
	queryClient: QueryClient;
}) => {
	const currentActiveShells = RnRussh.listSshConnectionsWithShells();
	const connection = currentActiveShells.find(
		(c) => c.connectionId === params.connectionId,
	);
	if (!connection) throw new Error('Connection not found');
	const shell = connection.shells.find((s) => s.channelId === params.channelId);
	if (!shell) throw new Error('Shell not found');
	await shell.close();
	if (connection.shells.length <= 1) await connection.disconnect();
	await params.queryClient.invalidateQueries({
		queryKey: listSshShellsQueryOptions.queryKey,
	});
};

export const disconnectSshConnectionAndInvalidateQuery = async (params: {
	connectionId: string;
	queryClient: QueryClient;
}) => {
	const connection = RnRussh.getSshConnection(params.connectionId);
	if (!connection) throw new Error('Connection not found');
	await connection.disconnect();
	await params.queryClient.invalidateQueries({
		queryKey: listSshShellsQueryOptions.queryKey,
	});
};
