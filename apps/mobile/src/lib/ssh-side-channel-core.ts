export type SideChannelResult = {
	success: boolean;
	output: string;
	error?: string;
	/** GitHub issue URL if detected in output */
	issueUrl?: string;
};

export type SideChannelLogger = {
	debug: (message: string, meta?: unknown) => void;
	warn: (message: string, meta?: unknown) => void;
	error: (message: string, meta?: unknown) => void;
};

export type SideChannelShellLike = {
	channelId: number;
	addListener: (
		listener: (event: unknown) => void,
		options: { cursor: { mode: 'live' } },
	) => bigint;
	removeListener: (listenerId: bigint) => void;
	sendData: (
		bytes: ArrayBuffer,
		opts?: { signal?: AbortSignal },
	) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type SideChannelConnectionLike = {
	startShell: (options: {
		term: 'Xterm';
		useTmux: false;
		tmuxSessionName: '';
		abortSignal?: AbortSignal;
		registerInStore?: false;
	}) => Promise<SideChannelShellLike>;
};

const SIDE_CHANNEL_CLEANUP_TIMEOUT_MS = 1_000;

type TerminalChunkLike = {
	bytes: ArrayBuffer;
	stream: unknown;
};

function isTerminalChunk(event: unknown): event is TerminalChunkLike {
	return (
		typeof event === 'object' &&
		event !== null &&
		'bytes' in event &&
		'stream' in event &&
		event.bytes instanceof ArrayBuffer
	);
}

function commandTimeoutError() {
	return new Error('Command timed out');
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout?: () => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					onTimeout?.();
					reject(commandTimeoutError());
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function getRemainingTimeoutMs(deadlineMs: number) {
	return Math.max(1, deadlineMs - Date.now());
}

async function closeSideChannelShell({
	shell,
	logger,
}: {
	shell: SideChannelShellLike;
	logger: SideChannelLogger;
}) {
	const closeAbortController = new AbortController();
	const closePromise = shell.close({
		signal: closeAbortController.signal,
	});
	try {
		await withTimeout(closePromise, SIDE_CHANNEL_CLEANUP_TIMEOUT_MS, () => {
			closeAbortController.abort(commandTimeoutError());
		});
		logger.debug('Side-channel shell closed');
	} catch (closeErr) {
		logger.warn('Failed to close side-channel shell', {
			error: closeErr,
		});
	}
}

/**
 * Execute a command on a side-channel SSH session.
 * Creates a temporary shell on the existing connection, runs the command,
 * captures output, and closes the shell - without interfering with the main terminal.
 */
export async function executeSideChannelCommandCore({
	connection,
	command,
	timeoutMs = 30000,
	logger,
}: {
	connection: SideChannelConnectionLike;
	command: string;
	timeoutMs?: number;
	logger: SideChannelLogger;
}): Promise<SideChannelResult> {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const deadlineMs = Date.now() + timeoutMs;

	// Unique marker to detect command completion
	const endMarker = `__SIDE_CHANNEL_DONE_${Date.now()}__`;

	logger.debug('Starting side-channel shell for command execution');

	const outputChunks: ArrayBuffer[] = [];
	let completed = false;
	let sideShell: SideChannelShellLike | null = null;
	let listenerId: bigint | null = null;
	const operationAbortController = new AbortController();

	// Cleanup handle to cancel polling when timeout fires
	const cleanupRef: { current: (() => void) | null } = { current: null };

	// Keep the exported command contract: shell creation/setup failures reject.
	const startShellPromise = connection.startShell({
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
		abortSignal: operationAbortController.signal,
		registerInStore: false,
	});
	try {
		sideShell = await withTimeout(
			startShellPromise,
			getRemainingTimeoutMs(deadlineMs),
			() => {
				operationAbortController.abort(commandTimeoutError());
			},
		);
	} catch (error) {
		void startShellPromise
			.then((lateShell) =>
				closeSideChannelShell({
					shell: lateShell,
					logger,
				}),
			)
			.catch(() => {});
		throw error;
	}

	try {
		logger.debug('Side-channel shell created', {
			channelId: sideShell.channelId,
		});

		// Add listener to capture output
		listenerId = sideShell.addListener(
			(event: unknown) => {
				if (isTerminalChunk(event)) {
					outputChunks.push(event.bytes);
				}
			},
			{ cursor: { mode: 'live' } },
		);

		// Send the command followed by exit code capture and end marker.
		const fullCommand = `${command}; __EC__=$?; echo "${endMarker}"; echo "EXIT_CODE:$__EC__"\n`;
		const encodedCommand = encoder.encode(fullCommand);
		await withTimeout(
			sideShell.sendData(encodedCommand.buffer as ArrayBuffer, {
				signal: operationAbortController.signal,
			}),
			getRemainingTimeoutMs(deadlineMs),
			() => {
				operationAbortController.abort(commandTimeoutError());
			},
		);

		const result = await withTimeout(
			waitForMarker(
				outputChunks,
				endMarker,
				decoder,
				() => completed,
				(cleanup) => {
					cleanupRef.current = cleanup;
				},
			),
			getRemainingTimeoutMs(deadlineMs),
		);

		completed = true;
		return result;
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		logger.error('Side-channel command failed', { error: errorMessage });
		return {
			success: false,
			output: '',
			error: errorMessage,
		};
	} finally {
		completed = true;
		cleanupRef.current?.();
		if (sideShell) {
			if (listenerId !== null) {
				try {
					sideShell.removeListener(listenerId);
				} catch (removeErr) {
					logger.warn('Failed to remove side-channel listener', {
						error: removeErr,
					});
				}
			}
			await closeSideChannelShell({
				shell: sideShell,
				logger,
			});
		}
	}
}

async function waitForMarker(
	chunks: ArrayBuffer[],
	marker: string,
	decoder: TextDecoder,
	isCompleted: () => boolean,
	onCleanup: (cleanup: () => void) => void,
): Promise<SideChannelResult> {
	return new Promise((resolve) => {
		let pendingTimeoutId: ReturnType<typeof setTimeout> | null = null;

		onCleanup(() => {
			if (pendingTimeoutId !== null) {
				clearTimeout(pendingTimeoutId);
				pendingTimeoutId = null;
			}
		});

		const checkForCompletion = () => {
			pendingTimeoutId = null;
			if (isCompleted()) return;

			const totalLength = chunks.reduce(
				(sum, chunk) => sum + chunk.byteLength,
				0,
			);
			const combined = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				combined.set(new Uint8Array(chunk), offset);
				offset += chunk.byteLength;
			}

			const output = decoder.decode(combined);
			const markerLineRegex = new RegExp(`^${marker}\\s*$`, 'm');
			if (markerLineRegex.test(output)) {
				const lines = output.split('\n');
				const markerLineIndex = lines.findIndex(
					(line) => line.trim() === marker,
				);
				const relevantLines = lines.slice(1, markerLineIndex);
				const cleanOutput = relevantLines.join('\n').trim();
				const exitCodeMatch = output.match(/EXIT_CODE:(\d+)/);
				const exitCode =
					exitCodeMatch?.[1] != null ? parseInt(exitCodeMatch[1], 10) : null;
				const hasError =
					exitCode !== null
						? exitCode !== 0
						: output.includes('error:') ||
							output.includes('Error:') ||
							output.includes('fatal:') ||
							output.includes('command not found');
				const issueUrlMatch = output.match(
					/https:\/\/github\.com\/[\w./-]+\/issues\/\d+/,
				);
				const issueUrl = issueUrlMatch ? issueUrlMatch[0] : undefined;

				resolve({
					success: !hasError,
					output: cleanOutput,
					error: hasError ? cleanOutput : undefined,
					issueUrl,
				});
				return;
			}

			pendingTimeoutId = setTimeout(checkForCompletion, 100);
		};

		checkForCompletion();
	});
}
