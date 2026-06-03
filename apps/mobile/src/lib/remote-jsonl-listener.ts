import { DEFAULT_REMOTE_COMMAND_TIMEOUT_MS } from './remote-command-runner';

export type RemoteJsonlCommandStreamEvent =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

export type RemoteJsonlStreamConnection = {
	startCommandStream: (
		opts: {
			command: string;
			onEvent: (event: RemoteJsonlCommandStreamEvent) => void;
		},
		asyncOpts?: { signal?: AbortSignal },
	) => Promise<{ close: (opts?: { signal?: AbortSignal }) => Promise<void> }>;
};

export type RemoteJsonlListenerHandle = {
	stop: () => Promise<void>;
};

function listenerTimeoutError() {
	return new Error('Remote JSONL listener operation timed out');
}

async function withListenerTimeout<T>(
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
					const error = listenerTimeoutError();
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

function emitLines({
	chunk,
	buffer,
	onLine,
}: {
	chunk: string;
	buffer: { current: string };
	onLine: (line: string) => void;
}) {
	buffer.current += chunk;
	const lines = buffer.current.split(/\r?\n/);
	buffer.current = lines.pop() ?? '';
	for (const line of lines) {
		if (!line.trim()) continue;
		onLine(line);
	}
}

export async function startRemoteJsonlListener(input: {
	connection: RemoteJsonlStreamConnection;
	command: string;
	operationTimeoutMs?: number;
	onLine: (line: string) => void;
	onStderr?: (line: string) => void;
	onExit: (error?: unknown) => void;
}): Promise<RemoteJsonlListenerHandle> {
	const operationTimeoutMs =
		input.operationTimeoutMs ?? DEFAULT_REMOTE_COMMAND_TIMEOUT_MS;
	let stopped = false;
	const stdoutBuffer = { current: '' };
	const stderrBuffer = { current: '' };
	const stdoutDecoder = new TextDecoder();
	const stderrDecoder = new TextDecoder();
	let stream: Awaited<
		ReturnType<RemoteJsonlStreamConnection['startCommandStream']>
	> | null = null;

	const closeStream = async (
		targetStream: NonNullable<typeof stream>,
		warnMessage: string,
	) => {
		const closeAbortController = new AbortController();
		await withListenerTimeout(
			targetStream.close({ signal: closeAbortController.signal }),
			operationTimeoutMs,
			(error) => closeAbortController.abort(error),
		).catch((error) => {
			console.warn(warnMessage, error);
		});
	};

	const reportExit = (error?: unknown, options?: { closeStream?: boolean }) => {
		if (stopped) return;
		stopped = true;
		if (options?.closeStream && stream) {
			void closeStream(
				stream,
				'failed to close remote JSONL listener after exit',
			);
		}
		try {
			input.onExit(error);
		} catch (exitError) {
			console.warn('remote JSONL listener exit handler failed', exitError);
		}
	};

	const startAbortController = new AbortController();
	const startPromise = input.connection.startCommandStream(
		{
			command: input.command,
			onEvent: (event) => {
				if (stopped) return;
				try {
					if (event.type === 'stdout') {
						emitLines({
							chunk: stdoutDecoder.decode(event.bytes, { stream: true }),
							buffer: stdoutBuffer,
							onLine: input.onLine,
						});
						return;
					}
					if (event.type === 'stderr') {
						emitLines({
							chunk: stderrDecoder.decode(event.bytes, { stream: true }),
							buffer: stderrBuffer,
							onLine: input.onStderr ?? (() => {}),
						});
						return;
					}
					if (event.type === 'exitStatus' && event.exitStatus !== 0) {
						reportExit(
							new Error(
								`Remote stream exited with status ${event.exitStatus}.`,
							),
							{ closeStream: true },
						);
						return;
					}
					if (event.type === 'exitSignal') {
						reportExit(
							new Error(
								`Remote stream exited with signal ${event.signalName}.`,
							),
							{ closeStream: true },
						);
						return;
					}
					if (event.type === 'closed') reportExit();
				} catch (error) {
					reportExit(error, { closeStream: true });
				}
			},
		},
		{ signal: startAbortController.signal },
	);
	try {
		stream = await withListenerTimeout(
			startPromise,
			operationTimeoutMs,
			(error) => startAbortController.abort(error),
		);
	} catch (error) {
		void startPromise
			.then((lateStream) =>
				closeStream(
					lateStream,
					'failed to close late remote JSONL listener stream',
				),
			)
			.catch(() => {});
		throw error;
	}

	return {
		stop: async () => {
			if (stopped) return;
			stopped = true;
			if (!stream) return;
			await closeStream(stream, 'failed to close remote JSONL listener');
		},
	};
}
