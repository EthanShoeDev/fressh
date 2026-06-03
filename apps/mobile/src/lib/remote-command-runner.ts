import {
	formatWorkmuxAppCommandFailureMessage,
	isWorkmuxAppCommand,
} from './workmux-app-commands';

export const DEFAULT_REMOTE_COMMAND_TIMEOUT_MS = 30_000;

export type RemoteCommandConnection = {
	runCommand: (
		opts: { command: string },
		asyncOpts?: { signal?: AbortSignal },
	) => Promise<{
		stdout: ArrayBuffer;
		stderr: ArrayBuffer;
		exitStatus: number | null;
		exitSignal: string | null;
	}>;
};

export type RemoteCommandFailureKind =
	| 'exit-status'
	| 'exit-signal'
	| 'missing-exit-status'
	| 'native-error'
	| 'timeout';

export type RemoteCommandResult =
	| {
			success: true;
			output: string;
			error?: undefined;
			failureKind?: undefined;
			rawError?: undefined;
			stderr: string;
			exitStatus: number;
			exitSignal: null;
	  }
	| {
			success: false;
			output: string;
			error: string;
			failureKind: RemoteCommandFailureKind;
			rawError?: string;
			stderr: string;
			exitStatus: number | null;
			exitSignal: string | null;
	  };

const decoder = new TextDecoder();
const REMOTE_COMMAND_TIMEOUT_MESSAGE = 'Remote command timed out';
const remoteCommandTimeoutMarker = Symbol('RemoteCommandTimeout');
type RemoteCommandTimeoutError = Error & {
	[remoteCommandTimeoutMarker]: true;
};

function isRemoteCommandTimeoutError(
	error: unknown,
): error is RemoteCommandTimeoutError {
	return (
		error instanceof Error &&
		remoteCommandTimeoutMarker in error &&
		error[remoteCommandTimeoutMarker] === true
	);
}

function decodeUtf8(bytes: ArrayBuffer): string {
	return decoder.decode(bytes);
}

function timeoutError(): RemoteCommandTimeoutError {
	const error = new Error(
		REMOTE_COMMAND_TIMEOUT_MESSAGE,
	) as RemoteCommandTimeoutError;
	error[remoteCommandTimeoutMarker] = true;
	return error;
}

async function withRemoteCommandTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: (error: Error) => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					const error = timeoutError();
					reject(error);
					onTimeout(error);
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function rawCommandError(input: { stderr: string; output: string }) {
	return input.stderr.trim() || input.output.trim() || undefined;
}

function commandFailureKind(input: {
	exitStatus: number | null;
	exitSignal: string | null;
}): RemoteCommandFailureKind {
	if (input.exitSignal) {
		return 'exit-signal';
	}
	if (input.exitStatus === null) return 'missing-exit-status';
	return 'exit-status';
}

function commandFailureMessage(input: {
	command: string;
	rawError: string | undefined;
	exitStatus: number | null;
	exitSignal: string | null;
}) {
	if (input.exitSignal) {
		return `Remote command exited with signal ${input.exitSignal}.`;
	}
	if (input.rawError) {
		return isWorkmuxAppCommand(input.command)
			? formatWorkmuxAppCommandFailureMessage(input.rawError)
			: input.rawError;
	}
	if (input.exitStatus === null) return 'Remote command exited without status.';
	return `Remote command exited with status ${input.exitStatus}.`;
}

export async function executeRemoteCommand({
	connection,
	command,
	timeoutMs = DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
}: {
	connection: RemoteCommandConnection;
	command: string;
	timeoutMs?: number;
}): Promise<RemoteCommandResult> {
	const abortController = new AbortController();
	try {
		const result = await withRemoteCommandTimeout(
			connection.runCommand(
				{ command },
				{
					signal: abortController.signal,
				},
			),
			timeoutMs,
			(error) => abortController.abort(error),
		);
		const output = decodeUtf8(result.stdout);
		const stderr = decodeUtf8(result.stderr);
		if (result.exitStatus === 0 && !result.exitSignal) {
			return {
				success: true,
				output,
				error: undefined,
				stderr,
				exitStatus: result.exitStatus,
				exitSignal: null,
			};
		}
		const rawError = rawCommandError({ stderr, output });
		return {
			success: false,
			output,
			error: commandFailureMessage({
				command,
				rawError,
				exitStatus: result.exitStatus,
				exitSignal: result.exitSignal,
			}),
			failureKind: commandFailureKind({
				exitStatus: result.exitStatus,
				exitSignal: result.exitSignal,
			}),
			...(rawError ? { rawError } : {}),
			stderr,
			exitStatus: result.exitStatus,
			exitSignal: result.exitSignal,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: '',
			error: errorMessage,
			failureKind: isRemoteCommandTimeoutError(error)
				? 'timeout'
				: 'native-error',
			rawError: errorMessage,
			stderr: '',
			exitStatus: null,
			exitSignal: null,
		};
	}
}

export async function runRemoteTextCommand(input: {
	connection: RemoteCommandConnection;
	command: string;
	timeoutMs?: number;
}): Promise<string> {
	const result = await executeRemoteCommand(input);
	if (!result.success) {
		throw new Error(result.error || 'Remote command failed.');
	}
	return result.output.trim();
}
