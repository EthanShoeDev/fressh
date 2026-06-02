import {
	addFresshEventListener,
	FresshEvent_Tags,
	SshConnectionProgressEvent,
} from '@fressh/react-native-terminal';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { rootLogger } from './logger';
import { secretsManager, type InputConnectionDetails } from './secrets-manager';
import { useSshStore } from './ssh-store';

const logger = rootLogger.extend('QueryFns');

/** Connection-progress states surfaced to the UI (mapped from the native enum). */
export type SshConnectionProgress = 'tcpConnected' | 'sshHandshake';

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	const router = useRouter();
	const connect = useSshStore((s) => s.connect);

	return useMutation({
		mutationFn: async (connectionDetails: InputConnectionDetails) => {
			// Progress events are global (the connectionId isn't known until connect
			// resolves), so subscribe for the duration of this connect attempt.
			const unsubscribe = addFresshEventListener((event) => {
				if (event.tag !== FresshEvent_Tags.ConnectProgress) {
					return;
				}
				const progress: SshConnectionProgress =
					event.inner.event === SshConnectionProgressEvent.TcpConnected
						? 'tcpConnected'
						: 'sshHandshake';
				logger.info('SSH connect progress event', progress);
				opts?.onConnectionProgress?.(progress);
			});

			try {
				logger.info('Connecting to SSH server...');
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
				});

				await secretsManager.connections.utils.upsertConnection({
					label: `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port}`,
					details: connectionDetails,
					priority: 0,
				});

				const shellHandle = await sshConnection.startShell();

				logger.info(
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
				logger.error('Error connecting to SSH server', error);
				throw error;
			} finally {
				unsubscribe();
			}
		},
	});
};
