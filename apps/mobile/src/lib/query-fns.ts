import {
	addFresshEventListener,
	FresshEvent_Tags,
	SshConnectionProgressEvent,
	SshError_Tags,
} from '@fressh/react-native-terminal';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import * as Cause from 'effect/Cause';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { rootLogger } from './logger';
import { preferences } from './preferences';
import {
	atomRuntime,
	secretsManager,
	type InputConnectionDetails,
} from './secrets-manager';
import { useSshStore } from './ssh-store';

const logger = rootLogger.extend('QueryFns');

/** Connection-progress states surfaced to the UI (mapped from the native enum). */
export type SshConnectionProgress = 'tcpConnected' | 'sshHandshake';

/** A connect failure shaped for humans: a headline, optional next step, and the
 *  raw technical detail kept around for logs / a "show details" affordance. */
export interface FriendlyError {
	title: string;
	hint?: string;
	detail: string;
}

class SshConnectError extends Data.TaggedError('SshConnectError')<{
	cause: unknown;
	friendly: FriendlyError;
}> {}

/**
 * Map a russh (`SshError::Ssh`) message — a free-form string from the OS/network
 * stack — onto a friendly headline + hint.
 */
function classifyRusshMessage(message: string): { title: string; hint?: string } {
	const m = message.toLowerCase();
	if (
		m.includes('lookup address') ||
		m.includes('no address associated') ||
		m.includes('failed to lookup') ||
		m.includes('name or service not known') ||
		m.includes('nodename nor servname')
	) {
		return {
			title: "Can't find that host",
			hint: 'Check the hostname for typos and that you’re on the right network.',
		};
	}
	if (m.includes('connection refused')) {
		return {
			title: 'Connection refused',
			hint: 'The host is reachable but nothing is listening on that port — check the port and that SSH is running.',
		};
	}
	if (m.includes('network is unreachable') || m.includes('no route to host')) {
		return {
			title: "Can't reach that network",
			hint: 'Check your connection/VPN and that the host is on a reachable network.',
		};
	}
	if (m.includes('timed out') || m.includes('timeout')) {
		return {
			title: 'Connection timed out',
			hint: 'The host didn’t respond — check the address, port, and any firewall.',
		};
	}
	if (
		m.includes('connection reset') ||
		m.includes('broken pipe') ||
		m.includes('unexpected eof') ||
		m.includes('early eof')
	) {
		return {
			title: 'The server closed the connection',
			hint: 'It may have rejected the connection early — check the server’s SSH config or logs.',
		};
	}
	return { title: 'SSH connection failed' };
}

/**
 * Turn any connect failure (uniffi `SshError`, a JS `Error`, anything) into a
 * user-presentable {@link FriendlyError}. uniffi errors only stringify to their
 * variant name, so we branch on the `tag` and dig the real message out of
 * `inner` — the russh `Ssh` variant gets a second pass for network specifics.
 */
export function classifyConnectError(error: unknown): FriendlyError {
	const detail = describeSshError(error);
	const tag =
		error && typeof error === 'object' && 'tag' in error
			? String((error as { tag: unknown }).tag)
			: undefined;
	const inner = (error as { inner?: unknown } | null)?.inner;
	const innerMessage = Array.isArray(inner)
		? inner.find((v): v is string => typeof v === 'string')
		: undefined;

	switch (tag) {
		case SshError_Tags.Auth:
			return {
				title: 'Authentication failed',
				hint: 'The server rejected your credentials — check the username, and that this key/password is authorized on the host.',
				detail,
			};
		case SshError_Tags.HostKeyRejected:
			return {
				title: 'Host key rejected',
				hint: 'The server’s identity didn’t match what was expected.',
				detail,
			};
		case SshError_Tags.Keys:
			return {
				title: 'Problem with the private key',
				hint: 'The key couldn’t be used — try re-importing it in the Keys tab.',
				detail,
			};
		case SshError_Tags.NotFound:
			return { title: 'Not found', detail };
		case SshError_Tags.Disconnected:
			return { title: 'Disconnected', hint: 'The connection dropped — try again.', detail };
		case SshError_Tags.Ssh:
			return { ...classifyRusshMessage(innerMessage ?? detail), detail };
		default:
			return { title: 'Failed to connect', detail };
	}
}

/**
 * uniffi error objects stringify to just their variant (e.g. "SshError.Ssh"),
 * hiding the message russh actually produced — which lives in the `inner` tuple.
 * Pull it out so logs/UI show the real cause.
 */
function describeSshError(error: unknown) {
	if (error && typeof error === 'object') {
		const tag = 'tag' in error ? String(error.tag) : undefined;
		const inner = (error as { inner?: unknown }).inner;
		const detail = Array.isArray(inner)
			? inner.filter((v) => typeof v === 'string').join(', ')
			: undefined;
		if (tag) {
			return detail ? `${tag}: ${detail}` : tag;
		}
		if (error instanceof Error) {
			return error.message;
		}
	}
	return String(error);
}

type ConnectInput = {
	connectionDetails: InputConnectionDetails;
	/** Persist the connection to the saved-servers list on success (default true). */
	save?: boolean;
	/** Per-host shell-integration choice from the connect form (default true).
	 *  ANDed with the global kill-switch to get the effective value. */
	shellIntegration?: boolean;
	onProgress?: (progressEvent: SshConnectionProgress) => void;
};

// Backed by the shared `atomRuntime` so `reactivityKeys` invalidates the saved
// connections list once a connect succeeds (it upserts the connection).
const connectAtom = atomRuntime.fn(
	Effect.fnUntraced(function* (input: ConnectInput) {
		const {
			connectionDetails,
			onProgress,
			save = true,
			shellIntegration: perHostShellIntegration = true,
		} = input;
		// Effective value = app-wide kill-switch ∧ this host's choice. Global off
		// disables it everywhere regardless of the per-host toggle.
		const shellIntegration =
			preferences.shellIntegrationEnabled.get() && perHostShellIntegration;
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
					let security:
						| { type: 'password'; password: string }
						| { type: 'key'; privateKey: string };
					if (connectionDetails.security.type === 'password') {
						security = {
							type: 'password',
							password: connectionDetails.security.password,
						};
					} else {
						const { keyId } = connectionDetails.security;
						const entry = await secretsManager.keys.utils.getPrivateKey(keyId);
						// Length only — never log key material.
						logger.info(
							`Resolved key ${keyId}: value length ${entry.value?.length ?? 'MISSING'}`,
						);
						if (!entry.value) {
							throw new Error(
								`The selected key (${keyId}) has no stored private key. Re-import it in the Keys tab.`,
							);
						}
						security = { type: 'key', privateKey: entry.value };
					}

					const sshConnection = await useSshStore.getState().connect({
						host: connectionDetails.host,
						port: connectionDetails.port,
						username: connectionDetails.username,
						security,
					});

					if (save) {
						await secretsManager.connections.utils.upsertConnection({
							label: `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port}`,
							details: connectionDetails,
							priority: 0,
							// Store the per-host CHOICE (not the global-gated effective
							// value) so toggling the global setting later still honors it.
							shellIntegration: perHostShellIntegration,
						});
					}

					const shellHandle = await sshConnection.startShell({
						shellIntegration,
					});

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
					// uniffi errors render as just the variant name (e.g.
					// "SshError.Ssh") and swallow the russh detail, which lives in
					// `inner`. Surface it so the cause is actually diagnosable.
					logger.error(
						`Error connecting to SSH server: ${describeSshError(error)}`,
						error,
					);
					throw error;
				} finally {
					unsubscribe();
				}
			},
			catch: (error) =>
				new SshConnectError({
					cause: error,
					friendly: classifyConnectError(error),
				}),
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
	const mutateAsync = async (
		connectionDetails: InputConnectionDetails,
		options?: { save?: boolean; shellIntegration?: boolean },
	) => {
		const success = await trigger({
			connectionDetails,
			save: options?.save,
			shellIntegration: options?.shellIntegration,
			onProgress: opts?.onConnectionProgress,
		});
		return success;
	};

	const failure = AsyncResult.isFailure(result) ? result : undefined;
	const squashed = failure ? Cause.squash(failure.cause) : undefined;
	// Prefer the friendly error the connect Effect already attached; fall back to
	// classifying whatever else squashed out of the Cause (defects, etc.).
	const error: FriendlyError | undefined =
		squashed instanceof SshConnectError
			? squashed.friendly
			: squashed !== undefined
				? classifyConnectError(squashed)
				: undefined;

	return {
		mutateAsync,
		isPending: result.waiting,
		isError: failure !== undefined,
		error,
	};
};
