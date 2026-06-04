import {
	addFresshEventListener,
	FresshEvent_Tags,
	SshConnectionProgressEvent,
} from '@fressh/react-native-terminal';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import * as Cause from 'effect/Cause';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { rootLogger } from './logger';
import {
	atomRuntime,
	secretsManager,
	type InputConnectionDetails,
} from './secrets-manager';
import { useSshStore } from './ssh-store';

const logger = rootLogger.extend('QueryFns');

/** Connection-progress states surfaced to the UI (mapped from the native enum). */
export type SshConnectionProgress = 'tcpConnected' | 'sshHandshake';

class SshConnectError extends Data.TaggedError('SshConnectError')<{
	cause: unknown;
}> {}

type ConnectInput = {
	connectionDetails: InputConnectionDetails;
	onProgress?: (progressEvent: SshConnectionProgress) => void;
};

// Backed by the shared `atomRuntime` so `reactivityKeys` invalidates the saved
// connections list once a connect succeeds (it upserts the connection).
const connectAtom = atomRuntime.fn(
	Effect.fnUntraced(function* (input: ConnectInput) {
		const { connectionDetails, onProgress } = input;
		return yield* Effect.tryPromise({
			try: async () => {
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
					onProgress?.(progress);
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

					const sshConnection = await useSshStore.getState().connect({
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
					return {
						connectionId: sshConnection.connectionId,
						channelId: shellHandle.channelId,
					};
				} catch (error) {
					logger.error('Error connecting to SSH server', error);
					throw error;
				} finally {
					unsubscribe();
				}
			},
			catch: (error) => new SshConnectError({ cause: error }),
		});
	}),
	{ reactivityKeys: secretsManager.reactivityKeys.connections },
);

export const useSshConnMutation = (opts?: {
	onConnectionProgress?: (progressEvent: SshConnectionProgress) => void;
}) => {
	const trigger = useAtomSet(connectAtom, { mode: 'promise' });
	const result = useAtomValue(connectAtom);

	// Connects (and auto-opens a first shell). Navigation is the caller's job —
	// the connect form replaces itself with the resulting terminal.
	const mutateAsync = async (connectionDetails: InputConnectionDetails) => {
		const success = await trigger({
			connectionDetails,
			onProgress: opts?.onConnectionProgress,
		});
		return success;
	};

	const failure = AsyncResult.isFailure(result) ? result : undefined;
	const squashed = failure ? Cause.squash(failure.cause) : undefined;
	const rawError =
		squashed instanceof SshConnectError ? squashed.cause : squashed;

	return {
		mutateAsync,
		isPending: result.waiting,
		isError: failure !== undefined,
		error:
			rawError instanceof Error
				? rawError
				: rawError !== undefined
					? new Error(String(rawError))
					: undefined,
	};
};
