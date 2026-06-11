import {
	addFresshEventListener,
	FresshEvent_Tags,
	runCommand,
	SshConnectionProgressEvent,
	SshError_Tags,
} from '@fressh/react-native-terminal';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import * as Cause from 'effect/Cause';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Match from 'effect/Match';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { atomRegistry } from './atom-registry';
import { hostKeyPromptQueueAtom } from './host-keys';
import { preferences } from './preferences';
import { appRuntime } from './runtime';
import {
	atomRuntime,
	secretsManager,
	type InputConnectionDetails,
} from './secrets-manager';
import { connectSsh, sshConnectionsAtom } from './ssh-store';

const annotateModule = Effect.annotateLogs({ module: 'QueryFns' });

/** Connection-progress states surfaced to the UI (mapped from the native enum). */
export type SshConnectionProgress = 'tcpConnected' | 'sshHandshake';

/** Fail a connect after this long with no progress event and no host-key
 *  prompt awaiting the user. Generous per-phase: every activity opens a fresh
 *  window. */
const CONNECT_INACTIVITY_TIMEOUT = '30 seconds';

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

class MissingPrivateKeyError extends Data.TaggedError(
	'MissingPrivateKeyError',
)<{
	message: string;
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
function classifyConnectError(error: unknown): FriendlyError {
	const detail = describeSshError(error);
	const tag =
		error && typeof error === 'object' && 'tag' in error
			? String((error as { tag: unknown }).tag)
			: undefined;
	const inner = (error as { inner?: unknown } | null)?.inner;
	const innerMessage = Array.isArray(inner)
		? inner.find((v): v is string => typeof v === 'string')
		: undefined;

	return Match.value(tag).pipe(
		Match.when(SshError_Tags.Auth, () => ({
			title: 'Authentication failed',
			hint: 'The server rejected your credentials — check the username, and that this key/password is authorized on the host.',
			detail,
		})),
		Match.when(SshError_Tags.HostKeyRejected, () => ({
			title: 'Host key rejected',
			hint: 'You declined the server’s host key, or its identity didn’t match what was expected.',
			detail,
		})),
		Match.when(SshError_Tags.Keys, () => ({
			title: 'Problem with the private key',
			hint: 'The key couldn’t be used — try re-importing it in the Keys tab.',
			detail,
		})),
		Match.when(SshError_Tags.NotFound, () => ({ title: 'Not found', detail })),
		Match.when(SshError_Tags.Disconnected, () => ({
			title: 'Disconnected',
			hint: 'The connection dropped — try again.',
			detail,
		})),
		Match.when(SshError_Tags.Ssh, () => ({
			...classifyRusshMessage(innerMessage ?? detail),
			detail,
		})),
		Match.orElse(() => ({ title: 'Failed to connect', detail })),
	);
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

/** Credential resolution shared by the connect form and the one-off runner:
 *  password passes through; a `keyId` is resolved to its stored private key. */
const resolveSecurity = Effect.fnUntraced(
	function* (details: InputConnectionDetails) {
		if (details.security.type === 'password') {
			return {
				type: 'password' as const,
				password: details.security.password,
			};
		}
		const { keyId } = details.security;
		const entry = yield* Effect.tryPromise(() =>
			secretsManager.keys.utils.getPrivateKey(keyId),
		);
		// Length only — never log key material.
		yield* Effect.logInfo(
			`Resolved key ${keyId}: value length ${entry.value?.length ?? 'MISSING'}`,
		);
		if (!entry.value) {
			return yield* new MissingPrivateKeyError({
				message: `The selected key (${keyId}) has no stored private key. Re-import it in the Keys tab.`,
			});
		}
		return { type: 'key' as const, privateKey: entry.value };
	},
	annotateModule,
);

/**
 * Ensure there is a live connection to `details`'s host, reusing one if present.
 * Returns the `connectionId` and `fresh` — true when WE opened it (the caller
 * should disconnect it when done; a reused connection is left alone). No shell is
 * opened. The host key goes through the TOFU prompt like any other connect.
 */
const ensureConnection = Effect.fnUntraced(function* (
	details: InputConnectionDetails,
) {
	const existing = yield* Effect.sync(() =>
		Object.values(atomRegistry.get(sshConnectionsAtom)).find(
			(c) =>
				c.connectionDetails.host === details.host &&
				c.connectionDetails.port === details.port &&
				c.connectionDetails.username === details.username,
		),
	);
	if (existing) {
		return { connectionId: existing.connectionId, fresh: false };
	}
	const security = yield* resolveSecurity(details);
	const conn = yield* connectSsh({
		host: details.host,
		port: details.port,
		username: details.username,
		security,
	});
	return { connectionId: conn.connectionId, fresh: true };
});

/** Reused / fresh connection handle the one-off runner threads between runs. */
export interface OneOffConnection {
	connectionId: string;
	fresh: boolean;
}

class RunCommandError extends Data.TaggedError('RunCommandError')<{
	message: string;
	cause: unknown;
}> {}

/**
 * One-off command runner (the Commands-tab sheet): connect-if-needed, then run
 * on a no-PTY `exec` channel in the login/home dir. An atom mutation so the
 * sheet reads pending / result / failure reactively instead of hand-rolling
 * state around a fiber.
 */
export const runCommandOneOffAtom = atomRuntime.fn(
	Effect.fnUntraced(
		function* (input: {
			details: InputConnectionDetails;
			command: string;
			/** Connection from a previous run in this sheet (reused, not reopened). */
			conn: OneOffConnection | null;
			onPhase?: (phase: 'connecting' | 'running') => void;
			/** Reports a freshly opened connection so the sheet can disconnect it
			 *  when it closes. */
			onConnection?: (conn: OneOffConnection) => void;
		}) {
			let conn = input.conn;
			if (!conn) {
				input.onPhase?.('connecting');
				conn = yield* ensureConnection(input.details);
				input.onConnection?.(conn);
			}
			input.onPhase?.('running');
			const target = conn;
			return yield* Effect.tryPromise(() =>
				runCommand(target.connectionId, input.command),
			);
		},
		// One user-facing failure shape; unwrap tryPromise's UnknownError so the
		// sheet shows the actual SSH/keychain cause.
		Effect.mapError((error) => {
			const cause = Cause.isUnknownError(error) ? error.cause : error;
			return new RunCommandError({ message: describeSshError(cause), cause });
		}),
		annotateModule,
	),
);

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
		// Every step's failure is classified into the one user-facing error shape
		// at its boundary. tryPromise wraps the thrown value in UnknownError —
		// classify the original, not the wrapper.
		const toConnectError = (error: unknown) => {
			const cause = Cause.isUnknownError(error) ? error.cause : error;
			return new SshConnectError({
				cause,
				friendly: classifyConnectError(cause),
			});
		};
		const connectStep = <A>(step: () => Promise<A>) =>
			Effect.tryPromise({ try: step, catch: toConnectError });

		const attempt = Effect.gen(function* () {
			yield* Effect.logInfo('Connecting to SSH server...');
			const security = yield* resolveSecurity(connectionDetails).pipe(
				Effect.mapError(toConnectError),
			);

			const sshConnection = yield* connectSsh({
				host: connectionDetails.host,
				port: connectionDetails.port,
				username: connectionDetails.username,
				security,
			}).pipe(Effect.mapError(toConnectError));

			if (save) {
				yield* secretsManager.connections.utils
					.upsertConnection({
						label: `${connectionDetails.username}@${connectionDetails.host}:${connectionDetails.port}`,
						details: connectionDetails,
						priority: 0,
						// Store the per-host CHOICE (not the global-gated effective
						// value) so toggling the global setting later still honors it.
						shellIntegration: perHostShellIntegration,
					})
					.pipe(Effect.mapError(toConnectError));
			}

			const shellHandle = yield* connectStep(() =>
				sshConnection.startShell({ shellIntegration }),
			);

			yield* Effect.logInfo(
				'Connected to SSH server',
				sshConnection.connectionId,
				shellHandle.channelId,
			);
			return {
				connectionId: sshConnection.connectionId,
				channelId: shellHandle.channelId,
			};
		});

		// "Something happened": a connect-progress event fired, or the host-key
		// prompt queue changed (a prompt appeared / was answered). One-shot:
		// listeners register per wait and are removed on resume or interrupt.
		const nextActivity = Effect.callback<void>((resume) => {
			const unsubscribeEvents = addFresshEventListener((event) => {
				if (event.tag === FresshEvent_Tags.ConnectProgress) {
					resume(Effect.void);
				}
			});
			const unsubscribeQueue = atomRegistry.subscribe(
				hostKeyPromptQueueAtom,
				() => {
					resume(Effect.void);
				},
			);
			return Effect.sync(() => {
				unsubscribeEvents();
				unsubscribeQueue();
			});
		});

		// The native connect has no timeout of its own, so a black-holed TCP
		// connect / handshake would leave the UI on "Connecting…" forever. Fail
		// after CONNECT_INACTIVITY_TIMEOUT without activity: each progress event
		// opens a fresh window (per-phase), and while a host-key trust prompt is
		// waiting on the user the wait is untimed (their reading time isn't the
		// network's). The underlying native attempt isn't cancellable from here —
		// if it ever resolves after we've given up, the connection just lands in
		// the store like any other.
		const watchdog = Effect.suspend(() =>
			atomRegistry.get(hostKeyPromptQueueAtom).length > 0
				? nextActivity
				: nextActivity.pipe(
						Effect.timeoutOrElse({
							duration: CONNECT_INACTIVITY_TIMEOUT,
							orElse: () =>
								Effect.fail(
									new SshConnectError({
										cause: new Error('connect inactivity timeout'),
										friendly: {
											title: 'Connection timed out',
											hint: 'No response from the server — check the host, port, and your network, then try again.',
											detail: `No progress for ${CONNECT_INACTIVITY_TIMEOUT}`,
										},
									}),
								),
						}),
					),
		).pipe(Effect.forever);

		// Progress events are global (the connectionId isn't known until connect
		// resolves), so stay subscribed for the duration of this connect attempt.
		const progressSubscription = Effect.acquireRelease(
			Effect.sync(() =>
				addFresshEventListener((event) => {
					if (event.tag !== FresshEvent_Tags.ConnectProgress) {
						return;
					}
					const progress: SshConnectionProgress =
						event.inner.event === SshConnectionProgressEvent.TcpConnected
							? 'tcpConnected'
							: 'sshHandshake';
					// Plain callback outside the connect fiber — log via the runtime.
					appRuntime.runSync(
						Effect.logInfo('SSH connect progress event', progress).pipe(
							annotateModule,
						),
					);
					onProgress?.(progress);
				}),
			),
			(unsubscribe) => Effect.sync(unsubscribe),
		);

		return yield* Effect.scoped(
			Effect.gen(function* () {
				yield* progressSubscription;
				return yield* Effect.raceFirst(attempt, watchdog);
			}),
		).pipe(
			// uniffi errors render as just the variant name (e.g. "SshError.Ssh")
			// and swallow the russh detail, which lives in `inner`. Surface it so
			// the cause is actually diagnosable.
			Effect.tapError((error) =>
				Effect.logError(
					`Error connecting to SSH server: ${describeSshError(error.cause)}`,
					error.cause,
				),
			),
			annotateModule,
		);
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
