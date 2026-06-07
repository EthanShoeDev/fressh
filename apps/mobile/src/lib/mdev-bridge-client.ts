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

const MDEV_BRIDGE_PROTOCOL_ERROR = 'mdev bridge protocol error.';
const MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR = 'mdev bridge request timed out.';
const MDEV_BRIDGE_STREAM_CLOSED_ERROR = 'mdev bridge stream closed.';
const MDEV_BRIDGE_CLIENT_DISPOSED_ERROR = 'mdev bridge client disposed.';
const MDEV_BRIDGE_COMMAND = 'mdev bridge --jsonl';

function errorResult(error: string): MdevBridgeResult {
	return { success: false, output: '', error };
}

function fatalResult(error: string): MdevBridgeValidationResult {
	return { result: errorResult(error), fatal: true };
}

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function includesAllRequiredOperations(
	operations: unknown[],
	requiredOperations: readonly string[],
): boolean {
	return requiredOperations.every((operation) => operations.includes(operation));
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
	let pending: PendingRequest | null = null;
	let stdoutBuffer = '';
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

	function markFailed(error: string) {
		if (disposed) return;
		failedError = failedError ?? error;
		finishPending(errorResult(failedError));
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
				failedError = result.result.error ?? MDEV_BRIDGE_PROTOCOL_ERROR;
			}
			finishPending(result.result);
			return;
		}

		finishPending({ success: true, output: '' });
	}

	function handleStdout(data: ArrayBuffer) {
		stdoutBuffer += new TextDecoder().decode(data);
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
				markFailed(MDEV_BRIDGE_STREAM_CLOSED_ERROR);
				break;
		}
	}

	async function ensureStream(): Promise<MdevBridgeCommandStream> {
		if (stream) return stream;
		if (streamPromise) return await streamPromise;

		const abortController = new AbortController();
		streamPromise = connection
			.startCommandStream({
				command: MDEV_BRIDGE_COMMAND,
				onEvent: handleEvent,
				abortSignal: abortController.signal,
			})
			.then((startedStream) => {
				if (disposed) {
					const abortController = new AbortController();
					void startedStream.close({ signal: abortController.signal });
					return startedStream;
				}
				stream = startedStream;
				return startedStream;
			})
			.catch(() => {
				failedError = MDEV_BRIDGE_UPDATE_MESSAGE;
				throw new Error(MDEV_BRIDGE_UPDATE_MESSAGE);
			});

		return await streamPromise;
	}

	async function closeStream() {
		const startedStream = stream;
		if (!startedStream) return;
		stream = null;
		const abortController = new AbortController();
		await startedStream.close({ signal: abortController.signal });
	}

	async function sendRequest({
		request,
		validate,
	}: {
		request: Record<string, unknown>;
		validate: PendingRequest['validate'];
	}): Promise<MdevBridgeResult> {
		if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
		if (failedError) return errorResult(failedError);

		const startedStream = await ensureStream();
		if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
		if (failedError) return errorResult(failedError);

		return await new Promise((resolve) => {
			const id = String(request.id);
			const timer = setTimeout(() => {
				if (pending?.id !== id) return;
				pending = null;
				failedError = MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR;
				resolve(errorResult(MDEV_BRIDGE_REQUEST_TIMEOUT_ERROR));
			}, requestTimeoutMs);

			pending = { id, resolve, timer, validate };
			startedStream.sendData(bytes(`${JSON.stringify(request)}\n`)).catch(() => {
				if (pending?.id !== id) return;
				failedError = MDEV_BRIDGE_STREAM_CLOSED_ERROR;
				finishPending(errorResult(MDEV_BRIDGE_STREAM_CLOSED_ERROR));
			});
		});
	}

	async function ensureHello(): Promise<MdevBridgeResult | null> {
		if (nextRequestId > 1) return null;

		const id = nextId();
		const result = await sendRequest({
			request: { id, type: 'hello' },
			validate: (response) =>
				validateHelloResponse(response, requiredOperations) ?? null,
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
			const helloResult = await ensureHello();
			if (helloResult) return helloResult;

			if (disposed) return errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR);
			if (failedError) return errorResult(failedError);

			const request: Record<string, unknown> = {
				id: nextId(),
				type: 'operation',
				operation: input.operation,
				params: input.params,
				timeoutMs: input.timeoutMs ?? requestTimeoutMs,
			};

			return await sendRequest({
				request,
				validate: (response) => validateOperationResponse(response),
			});
		} catch {
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
			finishPending(errorResult(MDEV_BRIDGE_CLIENT_DISPOSED_ERROR));
			await closeStream();
		},
	};
}
