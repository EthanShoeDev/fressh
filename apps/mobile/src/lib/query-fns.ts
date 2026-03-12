import {
	type RnRussh,
	type ConnectionDetails,
	type SshConnection,
	type SshConnectionProgress,
	type SshShell,
	SshError_Tags,
} from '@fressh/react-native-uniffi-russh';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { rootLogger } from './logger';
import { secretsManager, type InputConnectionDetails } from './secrets-manager';
import { connectAndRememberConnection } from './ssh-connect-flow';
import { useSshStore } from './ssh-store';
import { AbortSignalTimeout } from './utils';

const logger = rootLogger.extend('QueryFns');
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export type ConnectAndOpenShellResult =
	| {
			status: 'connected';
			sshConnection: SshConnection;
			shellHandle: SshShell;
			connectionId: string;
			channelId: number;
	  }
	| {
			status: 'tmux_attach_failed';
			connectionId: string;
			tmuxSessionName: string;
			storedConnectionId: string;
	  };

// Shared resolver for turning stored details into a connect-ready security object.
export async function resolveSecurityFromDetails(
	connectionDetails: InputConnectionDetails,
): Promise<ConnectionDetails['security']> {
	const privateKey = await secretsManager.keys.utils
		.getPrivateKey(connectionDetails.security.keyId)
		.then((e) => e.value);
	return {
		type: 'key',
		privateKey,
	};
}

// Shared connect flow used by both manual and silent auto-connect.
export async function connectAndOpenShell(args: {
	connectionDetails: InputConnectionDetails;
	connect: typeof RnRussh.connect;
	navigate: (params: { connectionId: string; channelId: number }) => void;
	navigateWithError?: (params: {
		connectionId: string;
		tmuxSessionName: string;
		storedConnectionId: string;
	}) => void;
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
	abortSignalTimeoutMs?: number;
	resolvedSecurity?: ConnectionDetails['security'];
}): Promise<ConnectAndOpenShellResult> {
	const {
		connectionDetails,
		connect,
		navigate,
		onConnectionProgress,
		abortSignalTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
		resolvedSecurity,
	} = args;
	const security =
		resolvedSecurity ?? (await resolveSecurityFromDetails(connectionDetails));

	const { sshConnection, storedConnectionId } =
		await connectAndRememberConnection({
			connectionDetails,
			connect,
			saveConnection: (params) =>
				secretsManager.connections.utils.upsertConnection(params),
			onConnectionProgress: (progressEvent) => {
				logger.info('SSH connect progress event', progressEvent);
				onConnectionProgress?.(progressEvent);
			},
			abortSignalTimeoutMs,
			resolvedSecurity: security,
		});
	let shellHandle: Awaited<ReturnType<typeof sshConnection.startShell>>;
	try {
		shellHandle = await sshConnection.startShell({
			term: 'Xterm',
			useTmux: connectionDetails.useTmux,
			tmuxSessionName: connectionDetails.tmuxSessionName,
			abortSignal: AbortSignalTimeout(abortSignalTimeoutMs),
		});
	} catch (error) {
		const err = error as { tag?: string };
		if (err?.tag === SshError_Tags.TmuxAttachFailed) {
			args.navigateWithError?.({
				connectionId: sshConnection.connectionId,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			});
			return {
				status: 'tmux_attach_failed',
				connectionId: sshConnection.connectionId,
				tmuxSessionName: connectionDetails.tmuxSessionName,
				storedConnectionId,
			};
		}
		throw error;
	}

	logger.info(
		'Connected to SSH server',
		sshConnection.connectionId,
		shellHandle.channelId,
	);
	navigate({
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	});

	return {
		status: 'connected',
		sshConnection,
		shellHandle,
		connectionId: sshConnection.connectionId,
		channelId: shellHandle.channelId,
	};
}

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	const router = useRouter();
	const connect = useSshStore((s) => s.connect);

	return useMutation({
		mutationFn: async (connectionDetails: InputConnectionDetails) => {
			try {
				logger.info('Connecting to SSH server...');
				await connectAndOpenShell({
					connectionDetails,
					connect,
					onConnectionProgress: (progressEvent) => {
						opts?.onConnectionProgress?.(progressEvent);
					},
					navigate: ({ connectionId, channelId }) => {
						router.push({
							pathname: '/shell/detail',
							params: {
								connectionId,
								channelId,
							},
						});
					},
					navigateWithError: ({
						connectionId,
						tmuxSessionName,
						storedConnectionId,
					}) => {
						router.push({
							pathname: '/shell/detail',
							params: {
								connectionId,
								channelId: '0',
								tmuxError: 'attach-failed',
								tmuxSessionName,
								storedConnectionId,
							},
						});
					},
				});
			} catch (error) {
				logger.error('Error connecting to SSH server', error);
				throw error;
			}
		},
	});
};
