import { prepareWorkmuxBridgeCommandForRemoteShell } from './workmux-app-commands';

export const MDEV_BRIDGE_UPDATE_MESSAGE =
	'Update mdev on the remote machine; this action requires mdev bridge --jsonl.';

export type MdevBridgeStreamEvent =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

export type MdevBridgeCommandStream = {
	sendData: (
		data: ArrayBuffer,
		opts?: { signal?: AbortSignal },
	) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type MdevBridgeStreamConnection = {
	startCommandStream: (opts: {
		command: string;
		onEvent: (event: MdevBridgeStreamEvent) => void;
		abortSignal?: AbortSignal;
	}) => Promise<MdevBridgeCommandStream>;
};

export type MdevBridgeClient = {
	runOperation: (input: {
		operation: string;
		params: Record<string, unknown>;
		timeoutMs?: number;
	}) => Promise<{ success: boolean; output: string; error?: string }>;
	dispose: () => Promise<void>;
};

type MdevBridgeResult = Awaited<ReturnType<MdevBridgeClient['runOperation']>>;

type MdevBridgeValidationResult = {
	result: MdevBridgeResult;
	fatal: boolean;
};

type PendingRequest = {
	id: string;
	resolve: (result: MdevBridgeResult) => void;
	timer: ReturnType<typeof setTimeout>;
	validate: (response: unknown) => MdevBridgeValidationResult | null;
};

type MdevBridgeRequestDeadline = {
	expiresAtMs: number;
};

const MDEV_BRIDGE_PROTOCOL_ERROR = 'mdev bridge protocol error.';
const MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR = 'mdev bridge request timed out.';
const MDEV_BRIDGE_STREAM_CLOSED_ERROR = 'mdev bridge stream closed.';
const MDEV_BRIDGE_CLIENT_DISPOSED_ERROR = 'mdev bridge client disposed.';
const MDEV_BRIDGE_COMMAND = prepareWorkmuxBridgeCommandForRemoteShell(
	'mdev bridge --jsonl',
);

function errorResult(error: string): MdevBridgeResult {
	return { success: false, output: '', error };
}

function fatalResult(error: string): MdevBridgeValidationResult {
	return { result: errorResult(error), fatal: true };
}

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function createRequestDeadline(timeoutMs: number): MdevBridgeRequestDeadline {
	return {
		expiresAtMs: nowMs() + timeoutMs,
	};
}

function getRemainingTimeoutMs(deadline: MdevBridgeRequestDeadline): number {
	return Math.max(0, Math.ceil(deadline.expiresAtMs - nowMs()));
}

async function withBridgeTimeout<T>(
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
					const error = new Error(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function includesAllRequiredOperations(
	operations: unknown[],
	requiredOperations: readonly string[],
): boolean {
	return requiredOperations.every((operation) =>
		operations.includes(operation),
	);
}

function validateHelloResponse(
	response: unknown,
	requiredOperations: readonly string[],
): MdevBridgeValidationResult | null {
	if (!isRecord(response)) return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	if (response.ok !== true) return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	if (response.protocolVersion !== 1) {
		return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	}

	if (
		!Array.isArray(response.supportedRequestTypes) ||
		!Array.isArray(response.operations)
	) {
		return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	}

	if (
		!response.supportedRequestTypes.includes('operation') ||
		!includesAllRequiredOperations(response.operations, requiredOperations)
	) {
		return fatalResult(MDEV_BRIDGE_UPDATE_MESSAGE);
	}

	return null;
}

function validateOperationResponse(
	response: unknown,
): MdevBridgeValidationResult {
	if (!isRecord(response)) return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
	if (response.ok === true) {
		return {
			result: {
				success: true,
				output: `${JSON.stringify(response.result ?? {})}\n`,
			},
			fatal: false,
		};
	}
	if (response.ok === false && typeof response.error === 'string') {
		return { result: errorResult(response.error), fatal: false };
	}
	return fatalResult(MDEV_BRIDGE_PROTOCOL_ERROR);
}

export function createMdevBridgeClient({
	connection,
	requiredOperations,
	requestTimeoutMs,
}: {
	connection: MdevBridgeStreamConnection;
	requiredOperations: readonly string[];
	requestTimeoutMs: number;
}): MdevBridgeClient {
	let disposed = false;
	let failedError: string | null = null;
	let nextRequestId = 1;
	let stream: MdevBridgeCommandStream | null = null;
	let streamPromise: Promise<MdevBridgeCommandStream> | null = null;
	let startupAbortController: AbortController | null = null;
	let startupDisposeRejecters: ((error: Error) => void)[] = [];
	let pending: PendingRequest | null = null;
	let stdoutBuffer = '';
	let helloComplete = false;
	const stdoutDecoder = new TextDecoder();
	let queue: Promise<void> = Promise.resolve();

	function nextId(): string {
		const id = `mdev-bridge-${nextRequestId}`;
		nextRequestId += 1;
		return id;
	}

	function finishPending(result: MdevBridgeResult) {
		const request = pending;
		if (!request) return;
		pending = null;
		clearTimeout(request.timer);
		request.resolve(result);
	}

	function closeStartedStreamInBackground() {
		const startedStream = stream;
		if (!startedStream) return;
		stream = null;
		void closeStreamWithTimeout(startedStream);
	}

	function markFailed(error: string) {
		if (disposed) return;
		failedError = failedError ?? error;
		closeStartedStreamInBackground();
		finishPending(errorResult(failedError));
	}

	function rejectStartupWaiters(error: Error) {
		const rejecters = startupDisposeRejecters;
		startupDisposeRejecters = [];
		for (const reject of rejecters) {
			reject(error);
		}
	}

	function waitForStartupDispose(): Promise<never> {
		if (disposed) {
			return Promise.reject(new Error(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR));
		}
		return new Promise((_, reject) => {
			startupDisposeRejecters.push(reject);
		});
	}

	function handleLine(line: string) {
		if (disposed || failedError) return;

		let response: unknown;
		try {
			response = JSON.parse(line);
		} catch {
			markFailed(MDEV_BRIDGE_PROTOCOL_ERROR);
			return;
		}

		if (!isRecord(response) || typeof response.id !== 'string') {
			markFailed(MDEV_BRIDGE_PROTOCOL_ERROR);
			return;
		}

		const request = pending;
		if (!request || response.id !== request.id) {
			markFailed(MDEV_BRIDGE_PROTOCOL_ERROR);
			return;
		}

		const result = request.validate(response);
		if (result) {
			if (!result.result.success && result.fatal) {
				markFailed(result.result.error ?? MDEV_BRIDGE_PROTOCOL_ERROR);
				return;
			}
			finishPending(result.result);
			return;
		}

		finishPending({ success: true, output: '' });
	}

	function handleStdout(data: ArrayBuffer) {
		stdoutBuffer += stdoutDecoder.decode(data, { stream: true });
		while (true) {
			const newlineIndex = stdoutBuffer.indexOf('\n');
			if (newlineIndex < 0) return;
			const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			handleLine(line);
		}
	}

	function handleEvent(event: MdevBridgeStreamEvent) {
		switch (event.type) {
			case 'stdout':
				handleStdout(event.bytes);
				break;
			case 'stderr':
				break;
			case 'exitStatus':
			case 'exitSignal':
			case 'closed':
				markFailed(
					helloComplete
						? MDEV_BRIDGE_STREAM_CLOSED_ERROR
						: MDEV_BRIDGE_UPDATE_MESSAGE,
				);
				break;
		}
	}

	async function closeStreamWithTimeout(targetStream: MdevBridgeCommandStream) {
		const abortController = new AbortController();
		let closePromise: Promise<void>;
		try {
			closePromise = targetStream.close({ signal: abortController.signal });
		} catch {
			return;
		}
		await withBridgeTimeout(closePromise, requestTimeoutMs, (error) =>
			abortController.abort(error),
		).catch(() => {});
	}

	async function ensureStream(
		startupTimeoutMs: number,
	): Promise<MdevBridgeCommandStream> {
		if (stream) return stream;
		if (streamPromise) return await streamPromise;

		const abortController = new AbortController();
		startupAbortController = abortController;
		let startCommandStreamPromise: Promise<MdevBridgeCommandStream>;
		try {
			startCommandStreamPromise = connection.startCommandStream({
				command: MDEV_BRIDGE_COMMAND,
				onEvent: handleEvent,
				abortSignal: abortController.signal,
			});
		} catch {
			if (startupAbortController === abortController) {
				startupAbortController = null;
				startupDisposeRejecters = [];
			}
			if (disposed) {
				throw new Error(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
			}
			failedError = failedError ?? MDEV_BRIDGE_UPDATE_MESSAGE;
			throw new Error(failedError);
		}

		const startedStreamPromise = startCommandStreamPromise
			.then((startedStream) => {
				if (startupAbortController === abortController) {
					startupAbortController = null;
					startupDisposeRejecters = [];
				}
				if (disposed || failedError) {
					void closeStreamWithTimeout(startedStream);
					throw new Error(
						disposed
							? MDEV_BRIDGE_CLIENT_DISPOSED_ERROR
							: (failedError ?? MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR),
					);
				}
				stream = startedStream;
				return startedStream;
			})
			.catch(() => {
				if (startupAbortController === abortController) {
					startupAbortController = null;
					startupDisposeRejecters = [];
				}
				if (disposed) {
					throw new Error(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
				}
				if (failedError) {
					throw new Error(failedError);
				}
				failedError = MDEV_BRIDGE_UPDATE_MESSAGE;
				throw new Error(MDEV_BRIDGE_UPDATE_MESSAGE);
			});

		streamPromise = Promise.race([
			withBridgeTimeout(startedStreamPromise, startupTimeoutMs, (error) => {
				if (startupAbortController === abortController) {
					failedError = MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR;
					abortController.abort(error);
					startupAbortController = null;
					startupDisposeRejecters = [];
				}
			}),
			waitForStartupDispose(),
		]);

		return await streamPromise;
	}

	async function closeStream() {
		const startedStream = stream;
		if (!startedStream) return;
		stream = null;
		await closeStreamWithTimeout(startedStream);
	}

	function failRequestDeadline(): MdevBridgeResult {
		markFailed(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR);
		return errorResult(failedError ?? MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR);
	}

	async function sendRequest({
		buildRequest,
		deadline,
		id,
		validate,
	}: {
		buildRequest: (timeoutMs: number) => Record<string, unknown>;
		deadline: MdevBridgeRequestDeadline;
		id: string;
		validate: PendingRequest['validate'];
	}): Promise<MdevBridgeResult> {
		if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
		if (failedError) return errorResult(failedError);

		const startupTimeoutMs = getRemainingTimeoutMs(deadline);
		if (startupTimeoutMs <= 0) return failRequestDeadline();

		const startedStream = await ensureStream(startupTimeoutMs);
		if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
		if (failedError) return errorResult(failedError);

		const localTimeoutMs = getRemainingTimeoutMs(deadline);
		if (localTimeoutMs <= 0) return failRequestDeadline();

		return await new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (pending?.id !== id) return;
				markFailed(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR);
			}, localTimeoutMs);

			pending = { id, resolve, timer, validate };
			let requestLine: string;
			try {
				requestLine = `${JSON.stringify(buildRequest(localTimeoutMs))}\n`;
			} catch {
				if (pending?.id !== id) return;
				markFailed(MDEV_BRIDGE_PROTOCOL_ERROR);
				return;
			}

			let sendPromise: Promise<void>;
			try {
				sendPromise = startedStream.sendData(bytes(requestLine));
			} catch {
				if (pending?.id !== id) return;
				const error = helloComplete
					? MDEV_BRIDGE_STREAM_CLOSED_ERROR
					: MDEV_BRIDGE_UPDATE_MESSAGE;
				markFailed(error);
				return;
			}

			sendPromise.catch(() => {
				if (pending?.id !== id) return;
				const error = helloComplete
					? MDEV_BRIDGE_STREAM_CLOSED_ERROR
					: MDEV_BRIDGE_UPDATE_MESSAGE;
				markFailed(error);
			});
		});
	}

	async function ensureHello(
		deadline: MdevBridgeRequestDeadline,
	): Promise<MdevBridgeResult | null> {
		if (nextRequestId > 1) return null;

		const id = nextId();
		const result = await sendRequest({
			deadline,
			id,
			buildRequest: () => ({ id, type: 'hello' }),
			validate: (response) => {
				const validation = validateHelloResponse(response, requiredOperations);
				if (validation) return validation;
				helloComplete = true;
				return null;
			},
		});

		if (!result.success || result.error) return result;
		return null;
	}

	async function runOperationNow(input: {
		operation: string;
		params: Record<string, unknown>;
		timeoutMs?: number;
	}): Promise<MdevBridgeResult> {
		if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
		if (failedError) return errorResult(failedError);

		try {
			const deadline = createRequestDeadline(
				input.timeoutMs ?? requestTimeoutMs,
			);
			const helloResult = await ensureHello(deadline);
			if (helloResult) return helloResult;

			if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
			if (failedError) return errorResult(failedError);

			const id = nextId();

			return await sendRequest({
				deadline,
				id,
				buildRequest: (timeoutMs) => ({
					id,
					type: 'operation',
					operation: input.operation,
					params: input.params,
					timeoutMs,
				}),
				validate: (response) => validateOperationResponse(response),
			});
		} catch {
			if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
			return errorResult(failedError ?? MDEV_BRIDGE_UPDATE_MESSAGE);
		}
	}

	return {
		runOperation: (input) => {
			const resultPromise = queue.then(() => runOperationNow(input));
			queue = resultPromise.then(
				() => undefined,
				() => undefined,
			);
			return resultPromise;
		},
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			startupAbortController?.abort();
			startupAbortController = null;
			rejectStartupWaiters(new Error(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR));
			finishPending(errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR));
			await closeStream();
		},
	};
}
