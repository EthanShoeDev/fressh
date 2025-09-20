import { type SshConnectionProgress } from '@fressh/react-native-uniffi-russh';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { secretsManager, type InputConnectionDetails } from './secrets-manager';
import { useSshStore } from './ssh-store';
import { AbortSignalTimeout } from './utils';

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	const router = useRouter();
	const connect = useSshStore((s) => s.connect);

	return useMutation({
		mutationFn: async (connectionDetails: InputConnectionDetails) => {
			try {
				console.log('Connecting to SSH server...');
				// Resolve security into the RN bridge shape
				const security =
					connectionDetails.security.type === 'password'
						? {
								type: 'password' as const,
								password: connectionDetails.security.password,
							}
						: {
								type: 'key' as const,
								privateKey: await secretsManager.keys.utils
									.getPrivateKey(connectionDetails.security.keyId)
									.then((e) => e.value),
							};

				const sshConnection = await connect({
					host: connectionDetails.host,
					port: connectionDetails.port,
					username: connectionDetails.username,
					security,
					onConnectionProgress: (progressEvent) => {
						console.log('SSH connect progress event', progressEvent);
						opts?.onConnectionProgress?.(progressEvent);
					},
					abortSignal: AbortSignalTimeout(5_000),
				});

				await secretsManager.connections.utils.upsertConnection({
					label: `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port}`,
					details: connectionDetails,
					priority: 0,
				});
				const shellHandle = await sshConnection.startShell({
					term: 'Xterm',
					abortSignal: AbortSignalTimeout(5_000),
				});

				console.log(
					'Connected to SSH server',
					sshConnection.connectionId,
					shellHandle.channelId,
				);
				router.push({
					pathname: '/shell/detail',
					params: {
						connectionId: sshConnection.connectionId,
						channelId: shellHandle.channelId,
					},
				});
			} catch (error) {
				console.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};
