import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import {
	MDEV_BRIDGE_UPDATE_MESSAGE,
	createMdevBridgeClient,
	type MdevBridgeStreamConnection,
	type MdevBridgeStreamEvent,
} from '../../src/lib/mdev-bridge-client';
import { WORKMUX_REMOTE_COMMAND_ENV_PREFIX } from '../../src/lib/workmux-app-commands';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function bufferFromBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function text(bytes: ArrayBuffer): string {
	return new TextDecoder().decode(bytes);
}

async function nextTick() {
	await waitTimeout(0);
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 100) {
	return await Promise.race([
		promise,
		waitTimeout(timeoutMs).then(() => {
			throw new Error(`test timed out after ${timeoutMs}ms`);
		}),
	]);
}

async function withMockPerformanceNow<T>(
	now: () => number,
	run: () => Promise<T>,
) {
	const originalNow = globalThis.performance.now;
	Object.defineProperty(globalThis.performance, 'now', {
		configurable: true,
		value: now,
	});
	try {
		return await run();
	} finally {
		Object.defineProperty(globalThis.performance, 'now', {
			configurable: true,
			value: originalNow,
		});
	}
}

function parseWrite(write: string): unknown {
	assert.match(write, /\n$/);
	return JSON.parse(write);
}

function assertOperationWrite(
	write: string,
	expected: Omit<Record<string, unknown>, 'timeoutMs'>,
	maxTimeoutMs: number,
) {
	const parsed = parseWrite(write);
	assert.equal(typeof parsed, 'object');
	assert.notEqual(parsed, null);
	assert.equal(Array.isArray(parsed), false);
	const { timeoutMs, ...rest } = parsed as Record<string, unknown>;
	assert.deepEqual(rest, expected);
	if (typeof timeoutMs !== 'number') {
		assert.fail('timeoutMs should be a number');
	}
	assert.ok(timeoutMs > 0, 'timeoutMs should be positive');
	assert.ok(
		timeoutMs <= maxTimeoutMs,
		'timeoutMs should not exceed the command deadline',
	);
}

function createBridgeFixture() {
	let onEvent: ((event: MdevBridgeStreamEvent) => void) | null = null;
	const starts: {
		command: string;
		abortSignal: AbortSignal | undefined;
	}[] = [];
	const writes: string[] = [];
	const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];

	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			starts.push({
				command: opts.command,
				abortSignal: opts.abortSignal,
			});
			onEvent = opts.onEvent;
			return {
				sendData: async (data) => {
					writes.push(text(data));
				},
				close: async (opts) => {
					closeOptions.push(opts);
				},
			};
		},
	};

	return {
		closeOptions,
		connection,
		starts,
		writes,
		emit(event: MdevBridgeStreamEvent) {
			assert.ok(onEvent, 'stream was not started');
			onEvent(event);
		},
		emitJson(value: unknown) {
			this.emit({ type: 'stdout', bytes: bytes(`${JSON.stringify(value)}\n`) });
		},
	};
}

const EXPECTED_MDEV_BRIDGE_COMMAND = `${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} mdev bridge --jsonl`;

function helloResponse(overrides?: Record<string, unknown>) {
	return {
		id: 'mdev-bridge-1',
		ok: true,
		protocolVersion: 1,
		supportedRequestTypes: ['operation'],
		operations: ['op.one', 'op.two'],
		...overrides,
	};
}

void test('starts bridge, sends hello before operation, validates capabilities, sends operation, and returns JSON output', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: { target: 'pane' },
		timeoutMs: 250,
	});
	await nextTick();

	assert.deepEqual(fixture.starts, [
		{
			command: EXPECTED_MDEV_BRIDGE_COMMAND,
			abortSignal: fixture.starts[0]?.abortSignal,
		},
	]);
	assert.match(fixture.starts[0]?.command ?? '', /PATH="\$PATH:\$HOME\/bin"/);
	assert.match(fixture.starts[0]?.command ?? '', /mdev bridge --jsonl/);
	assert.equal(fixture.starts[0]?.abortSignal instanceof AbortSignal, true);
	assert.equal(fixture.writes.length, 1);
	assert.deepEqual(parseWrite(fixture.writes[0] ?? ''), {
		id: 'mdev-bridge-1',
		type: 'hello',
	});

	fixture.emitJson(helloResponse());
	await nextTick();

	assert.equal(fixture.writes.length, 2);
	assertOperationWrite(
		fixture.writes[1] ?? '',
		{
			id: 'mdev-bridge-2',
			type: 'operation',
			operation: 'op.one',
			params: { target: 'pane' },
		},
		250,
	);

	fixture.emitJson({
		id: 'mdev-bridge-2',
		ok: true,
		result: { changed: true },
	});

	assert.deepEqual(await resultPromise, {
		success: true,
		output: '{"changed":true}\n',
	});
});

void test('missing operation capability fails with update message and does not send operation', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one', 'op.missing'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse({ operations: ['op.one'] }));

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: MDEV_BRIDGE_UPDATE_MESSAGE,
	});
	await nextTick();
	assert.equal(fixture.closeOptions.length, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.equal(fixture.writes.length, 1);
});

void test('missing request type capability fails with update message and does not send operation', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse({ supportedRequestTypes: [] }));

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: MDEV_BRIDGE_UPDATE_MESSAGE,
	});
	await nextTick();
	assert.equal(fixture.closeOptions.length, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.equal(fixture.writes.length, 1);
});

void test('ok false operation response surfaces bridge error', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();
	fixture.emitJson({
		id: 'mdev-bridge-2',
		ok: false,
		error: 'operation failed',
	});

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'operation failed',
	});

	const secondResultPromise = client.runOperation({
		operation: 'op.one',
		params: { retry: true },
	});
	await nextTick();
	assert.deepEqual(parseWrite(fixture.writes[2] ?? ''), {
		id: 'mdev-bridge-3',
		type: 'operation',
		operation: 'op.one',
		params: { retry: true },
		timeoutMs: 100,
	});

	fixture.emitJson({
		id: 'mdev-bridge-3',
		ok: true,
		result: { retried: true },
	});
	assert.deepEqual(await secondResultPromise, {
		success: true,
		output: '{"retried":true}\n',
	});
});

void test('stream closed fails pending and future requests', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();
	fixture.emit({ type: 'closed' });

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge stream closed.',
	});
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge stream closed.',
		},
	);
});

void test('stream closed immediately after valid hello is post-hello stream closed', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	fixture.emit({ type: 'closed' });

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge stream closed.',
	});
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge stream closed.',
		},
	);
});

void test('hello write failure asks user to update mdev', async () => {
	const writes: string[] = [];
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async () => ({
			sendData: async (data) => {
				writes.push(text(data));
				throw new Error('hello write failed');
			},
			close: async () => {},
		}),
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();

	assert.deepEqual(parseWrite(writes[0] ?? ''), {
		id: 'mdev-bridge-1',
		type: 'hello',
	});
	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: MDEV_BRIDGE_UPDATE_MESSAGE,
	});
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: MDEV_BRIDGE_UPDATE_MESSAGE,
		},
	);
});

void test('synchronous hello write throw cleans up and preserves update failure', async () => {
	const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];
	const writes: string[] = [];
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async () => ({
			sendData: (data) => {
				writes.push(text(data));
				throw new Error('sync hello write failed');
			},
			close: async (opts) => {
				closeOptions.push(opts);
			},
		}),
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 10,
	});

	const result = await withTestTimeout(
		client.runOperation({ operation: 'op.one', params: {} }),
	);

	assert.deepEqual(parseWrite(writes[0] ?? ''), {
		id: 'mdev-bridge-1',
		type: 'hello',
	});
	assert.deepEqual(result, {
		success: false,
		output: '',
		error: MDEV_BRIDGE_UPDATE_MESSAGE,
	});
	await waitTimeout(20);
	assert.equal(closeOptions.length, 1);
	assert.equal(closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: MDEV_BRIDGE_UPDATE_MESSAGE,
		},
	);
});

void test('synchronous startup throw fails sticky with update message', async () => {
	let starts = 0;
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: () => {
			starts += 1;
			throw new Error('sync startup failed');
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: MDEV_BRIDGE_UPDATE_MESSAGE,
		},
	);
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: MDEV_BRIDGE_UPDATE_MESSAGE,
		},
	);
	assert.equal(starts, 1);
});

void test('operation write failure after hello is stream closed', async () => {
	let onEvent: ((event: MdevBridgeStreamEvent) => void) | null = null;
	const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];
	const writes: string[] = [];
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			onEvent = opts.onEvent;
			return {
				sendData: async (data) => {
					writes.push(text(data));
					if (writes.length === 2) {
						throw new Error('operation write failed');
					}
				},
				close: async (opts) => {
					closeOptions.push(opts);
				},
			};
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	const emit = onEvent as ((event: MdevBridgeStreamEvent) => void) | null;
	assert.ok(emit, 'stream was not started');
	emit({
		type: 'stdout',
		bytes: bytes(`${JSON.stringify(helloResponse())}\n`),
	});
	await nextTick();

	assertOperationWrite(
		writes[1] ?? '',
		{
			id: 'mdev-bridge-2',
			type: 'operation',
			operation: 'op.one',
			params: {},
		},
		100,
	);
	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge stream closed.',
	});
	await nextTick();
	assert.equal(closeOptions.length, 1);
	assert.equal(closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge stream closed.',
		},
	);
});

void test('protocol error closes the started bridge stream', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emit({ type: 'stdout', bytes: bytes('{bad json}\n') });

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});
	await nextTick();
	assert.equal(fixture.closeOptions.length, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
});

void test('post-start request timeout closes the bridge stream', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 10,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();
	assertOperationWrite(
		fixture.writes[1] ?? '',
		{
			id: 'mdev-bridge-2',
			type: 'operation',
			operation: 'op.one',
			params: {},
		},
		10,
	);

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
	await nextTick();
	assert.equal(fixture.closeOptions.length, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
});

void test('operation serialization failure closes stream and preserves failed state', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 10,
	});
	const cyclicParams: Record<string, unknown> = {};
	cyclicParams.self = cyclicParams;

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: cyclicParams,
	});
	await nextTick();
	fixture.emitJson(helloResponse());

	assert.deepEqual(await withTestTimeout(resultPromise), {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});
	assert.equal(fixture.writes.length, 1);
	await waitTimeout(20);
	assert.equal(fixture.closeOptions.length, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge protocol error.',
		},
	);
});

void test('queued operation behind protocol failure settles without another write', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one', 'op.two'],
		requestTimeoutMs: 100,
	});

	const firstResultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	const secondResultPromise = client.runOperation({
		operation: 'op.two',
		params: {},
	});
	await nextTick();
	assert.equal(fixture.writes.length, 1);
	fixture.emit({ type: 'stdout', bytes: bytes('{bad json}\n') });

	assert.deepEqual(await firstResultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});
	assert.deepEqual(await withTestTimeout(secondResultPromise), {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});
	assert.equal(fixture.writes.length, 1);
	await nextTick();
	assert.equal(fixture.closeOptions.length, 1);
});

void test('synchronous close throw during terminal cleanup is swallowed', async () => {
	const unhandledRejections: unknown[] = [];
	const onUnhandledRejection = (reason: unknown) => {
		unhandledRejections.push(reason);
	};
	let onEvent: ((event: MdevBridgeStreamEvent) => void) | null = null;
	let closeCalls = 0;
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			onEvent = opts.onEvent;
			return {
				sendData: async () => {},
				close: () => {
					closeCalls += 1;
					throw new Error('sync close failed');
				},
			};
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	process.on('unhandledRejection', onUnhandledRejection);
	try {
		const resultPromise = client.runOperation({
			operation: 'op.one',
			params: {},
		});
		await nextTick();
		const emit = onEvent as ((event: MdevBridgeStreamEvent) => void) | null;
		assert.ok(emit, 'stream was not started');
		emit({ type: 'stdout', bytes: bytes('{bad json}\n') });

		assert.deepEqual(await resultPromise, {
			success: false,
			output: '',
			error: 'mdev bridge protocol error.',
		});
		await waitTimeout(20);
		assert.equal(closeCalls, 1);
		assert.deepEqual(unhandledRejections, []);
	} finally {
		process.off('unhandledRejection', onUnhandledRejection);
	}
});

void test('malformed response and invalid hello fail with protocol error', async () => {
	const malformedFixture = createBridgeFixture();
	const malformedClient = createMdevBridgeClient({
		connection: malformedFixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});
	const malformedResultPromise = malformedClient.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	malformedFixture.emit({ type: 'stdout', bytes: bytes('{bad json}\n') });

	assert.deepEqual(await malformedResultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});

	const invalidHelloFixture = createBridgeFixture();
	const invalidHelloClient = createMdevBridgeClient({
		connection: invalidHelloFixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});
	const invalidHelloResultPromise = invalidHelloClient.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	invalidHelloFixture.emitJson(helloResponse({ protocolVersion: 2 }));

	assert.deepEqual(await invalidHelloResultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});

	const invalidRequestTypesFixture = createBridgeFixture();
	const invalidRequestTypesClient = createMdevBridgeClient({
		connection: invalidRequestTypesFixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});
	const invalidRequestTypesResultPromise =
		invalidRequestTypesClient.runOperation({
			operation: 'op.one',
			params: {},
		});
	await nextTick();
	invalidRequestTypesFixture.emitJson(
		helloResponse({ supportedRequestTypes: 'operation' }),
	);

	assert.deepEqual(await invalidRequestTypesResultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});

	const invalidOperationsFixture = createBridgeFixture();
	const invalidOperationsClient = createMdevBridgeClient({
		connection: invalidOperationsFixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});
	const invalidOperationsResultPromise = invalidOperationsClient.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	invalidOperationsFixture.emitJson(helloResponse({ operations: 'op.one' }));

	assert.deepEqual(await invalidOperationsResultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});

	const mismatchFixture = createBridgeFixture();
	const mismatchClient = createMdevBridgeClient({
		connection: mismatchFixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});
	const mismatchResultPromise = mismatchClient.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	mismatchFixture.emitJson({ ...helloResponse(), id: 'wrong-id' });

	assert.deepEqual(await mismatchResultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge protocol error.',
	});
});

void test('unanswered request times out and future requests fail', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 10,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge request timed out.',
		},
	);
});

void test('unresolved startup times out, aborts startup, and fails future requests', async () => {
	let capturedStart:
		| {
				command: string;
				abortSignal: AbortSignal | undefined;
		  }
		| undefined;
	let resolveStart:
		| ((stream: {
				sendData: (data: ArrayBuffer) => Promise<void>;
				close: (opts?: { signal?: AbortSignal }) => Promise<void>;
		  }) => void)
		| undefined;
	const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			capturedStart = {
				command: opts.command,
				abortSignal: opts.abortSignal,
			};
			return await new Promise((resolve) => {
				resolveStart = resolve;
			});
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 10,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();

	assert.equal(capturedStart?.command, EXPECTED_MDEV_BRIDGE_COMMAND);
	assert.deepEqual(await withTestTimeout(resultPromise), {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
	assert.equal(capturedStart?.abortSignal?.aborted, true);
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge request timed out.',
		},
	);

	assert.ok(resolveStart, 'start promise resolver was not captured');
	resolveStart({
		sendData: async () => {},
		close: async (opts) => {
			closeOptions.push(opts);
		},
	});
	await nextTick();

	assert.equal(closeOptions.length, 1);
	assert.equal(closeOptions[0]?.signal instanceof AbortSignal, true);
});

void test('per-operation timeout override controls cold startup timeout', async () => {
	let capturedStart:
		| {
				command: string;
				abortSignal: AbortSignal | undefined;
		  }
		| undefined;
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			capturedStart = {
				command: opts.command,
				abortSignal: opts.abortSignal,
			};
			return await new Promise(() => {});
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 500,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
		timeoutMs: 10,
	});
	await nextTick();

	assert.equal(capturedStart?.command, EXPECTED_MDEV_BRIDGE_COMMAND);
	assert.deepEqual(await withTestTimeout(resultPromise, 100), {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
	assert.equal(capturedStart?.abortSignal?.aborted, true);
});

void test('per-operation timeout override controls initial hello timeout', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 500,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
		timeoutMs: 10,
	});
	await nextTick();

	assert.deepEqual(parseWrite(fixture.writes[0] ?? ''), {
		id: 'mdev-bridge-1',
		type: 'hello',
	});
	assert.deepEqual(await withTestTimeout(resultPromise, 100), {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
	assert.equal(fixture.writes.length, 1);
});

void test('per-operation timeout is a single deadline across cold startup and hello', async () => {
	let currentNowMs = 1_000;
	await withMockPerformanceNow(() => currentNowMs, async () => {
		const writes: string[] = [];
		const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];
		const stream =
			createDeferred<
				Awaited<ReturnType<MdevBridgeStreamConnection['startCommandStream']>>
			>();
		const connection: MdevBridgeStreamConnection = {
			startCommandStream: async () => await stream.promise,
		};
		const client = createMdevBridgeClient({
			connection,
			requiredOperations: ['op.one'],
			requestTimeoutMs: 500,
		});

		const resultPromise = client.runOperation({
			operation: 'op.one',
			params: {},
			timeoutMs: 100,
		});
		await nextTick();

		currentNowMs = 1_095;
		stream.resolve({
			sendData: async (data) => {
				writes.push(text(data));
			},
			close: async (opts) => {
				closeOptions.push(opts);
			},
		});
		await nextTick();

		assert.deepEqual(parseWrite(writes[0] ?? ''), {
			id: 'mdev-bridge-1',
			type: 'hello',
		});
		assert.deepEqual(await withTestTimeout(resultPromise, 100), {
			success: false,
			output: '',
			error: 'mdev bridge request timed out.',
		});
		await nextTick();
		assert.equal(closeOptions.length, 1);
		assert.equal(closeOptions[0]?.signal instanceof AbortSignal, true);
	});
});

void test('per-operation timeout override controls the local watchdog', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 500,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
		timeoutMs: 10,
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();

	assertOperationWrite(
		fixture.writes[1] ?? '',
		{
			id: 'mdev-bridge-2',
			type: 'operation',
			operation: 'op.one',
			params: {},
		},
		10,
	);
	assert.deepEqual(await withTestTimeout(resultPromise, 100), {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
});

void test('operations queue sequentially', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one', 'op.two'],
		requestTimeoutMs: 100,
	});

	const firstResultPromise = client.runOperation({
		operation: 'op.one',
		params: { order: 1 },
	});
	const secondResultPromise = client.runOperation({
		operation: 'op.two',
		params: { order: 2 },
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();

	assert.equal(fixture.writes.length, 2);
	assertOperationWrite(
		fixture.writes[1] ?? '',
		{
			id: 'mdev-bridge-2',
			type: 'operation',
			operation: 'op.one',
			params: { order: 1 },
		},
		100,
	);

	fixture.emitJson({ id: 'mdev-bridge-2', ok: true, result: { order: 1 } });
	assert.deepEqual(await firstResultPromise, {
		success: true,
		output: '{"order":1}\n',
	});
	await nextTick();

	assert.equal(fixture.writes.length, 3);
	assertOperationWrite(
		fixture.writes[2] ?? '',
		{
			id: 'mdev-bridge-3',
			type: 'operation',
			operation: 'op.two',
			params: { order: 2 },
		},
		100,
	);

	fixture.emitJson({ id: 'mdev-bridge-3', ok: true, result: { order: 2 } });
	assert.deepEqual(await secondResultPromise, {
		success: true,
		output: '{"order":2}\n',
	});
});

void test('queued operation timeout starts at public runOperation call', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one', 'op.two'],
		requestTimeoutMs: 500,
	});

	const firstResultPromise = client.runOperation({
		operation: 'op.one',
		params: { order: 1 },
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();

	assert.equal(fixture.writes.length, 2);
	const secondResultPromise = client.runOperation({
		operation: 'op.two',
		params: { order: 2 },
		timeoutMs: 10,
	});
	await waitTimeout(20);
	assert.equal(fixture.writes.length, 2);

	assert.deepEqual(await withTestTimeout(secondResultPromise, 100), {
		success: false,
		output: '',
		error: 'mdev bridge request timed out.',
	});
	assert.equal(fixture.writes.length, 2);

	fixture.emitJson({ id: 'mdev-bridge-2', ok: true, result: { order: 1 } });
	assert.deepEqual(await firstResultPromise, {
		success: true,
		output: '{"order":1}\n',
	});
	await nextTick();
	assert.equal(fixture.writes.length, 2);
	const thirdResultPromise = client.runOperation({
		operation: 'op.two',
		params: { order: 3 },
	});
	await nextTick();
	assert.equal(fixture.writes.length, 3);
	assertOperationWrite(
		fixture.writes[2] ?? '',
		{
			id: 'mdev-bridge-4',
			type: 'operation',
			operation: 'op.two',
			params: { order: 3 },
		},
		500,
	);
	fixture.emitJson({ id: 'mdev-bridge-4', ok: true, result: { order: 3 } });
	assert.deepEqual(await thirdResultPromise, {
		success: true,
		output: '{"order":3}\n',
	});
});

void test('stderr alone does not fail an operation', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();
	fixture.emit({ type: 'stderr', bytes: bytes('diagnostic warning\n') });
	fixture.emitJson({ id: 'mdev-bridge-2', ok: true, result: null });

	assert.deepEqual(await resultPromise, {
		success: true,
		output: '{}\n',
	});
});

void test('partial stdout lines buffer until newline', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emit({ type: 'stdout', bytes: bytes('{"id":"mdev-bridge-1"') });
	await nextTick();
	assert.equal(fixture.writes.length, 1);

	fixture.emit({
		type: 'stdout',
		bytes: bytes(
			',"ok":true,"protocolVersion":1,"supportedRequestTypes":["operation"],"operations":["op.one"]}\n',
		),
	});
	await nextTick();
	assert.equal(fixture.writes.length, 2);

	fixture.emit({ type: 'stdout', bytes: bytes('{"id":"mdev-bridge-2"') });
	await nextTick();
	fixture.emit({
		type: 'stdout',
		bytes: bytes(',"ok":true,"result":{"partial":true}}\n'),
	});

	assert.deepEqual(await resultPromise, {
		success: true,
		output: '{"partial":true}\n',
	});
});

void test('pre-hello stream exit asks user to update mdev', async () => {
	for (const event of [
		{ type: 'closed' } as const,
		{ type: 'exitStatus', exitStatus: 127 } as const,
	]) {
		const fixture = createBridgeFixture();
		const client = createMdevBridgeClient({
			connection: fixture.connection,
			requiredOperations: ['op.one'],
			requestTimeoutMs: 100,
		});

		const resultPromise = client.runOperation({
			operation: 'op.one',
			params: {},
		});
		await nextTick();
		fixture.emit(event);

		assert.deepEqual(await resultPromise, {
			success: false,
			output: '',
			error: MDEV_BRIDGE_UPDATE_MESSAGE,
		});
		assert.deepEqual(
			await client.runOperation({ operation: 'op.one', params: {} }),
			{
				success: false,
				output: '',
				error: MDEV_BRIDGE_UPDATE_MESSAGE,
			},
		);
	}
});

void test('split UTF-8 stdout chunks parse without corrupting JSON strings', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();
	fixture.emitJson(helloResponse());
	await nextTick();

	const line = `${JSON.stringify({
		id: 'mdev-bridge-2',
		ok: true,
		result: { word: 'café' },
	})}\n`;
	const encoded = new TextEncoder().encode(line);
	const characterIndex = line.indexOf('é');
	assert.notEqual(characterIndex, -1);
	const splitIndex =
		new TextEncoder().encode(line.slice(0, characterIndex)).length + 1;

	fixture.emit({
		type: 'stdout',
		bytes: bufferFromBytes(encoded.slice(0, splitIndex)),
	});
	await nextTick();
	fixture.emit({
		type: 'stdout',
		bytes: bufferFromBytes(encoded.slice(splitIndex)),
	});

	assert.deepEqual(await resultPromise, {
		success: true,
		output: '{"word":"café"}\n',
	});
});

void test('dispose closes stream and future run returns disposed error', async () => {
	const fixture = createBridgeFixture();
	const client = createMdevBridgeClient({
		connection: fixture.connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();

	await client.dispose();

	assert.deepEqual(await resultPromise, {
		success: false,
		output: '',
		error: 'mdev bridge client disposed.',
	});
	assert.equal(fixture.closeOptions.length, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.deepEqual(
		await client.runOperation({ operation: 'op.one', params: {} }),
		{
			success: false,
			output: '',
			error: 'mdev bridge client disposed.',
		},
	);
});

void test('dispose with hanging stream close resolves and aborts close signal', async () => {
	let closeSignal: AbortSignal | undefined;
	let onEvent: ((event: MdevBridgeStreamEvent) => void) | undefined;
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			onEvent = opts.onEvent;
			return {
				sendData: async () => {},
				close: async (opts) => {
					closeSignal = opts?.signal;
					await new Promise(() => {});
				},
			};
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 10,
	});

	const resultPromise = client.runOperation({
		operation: 'op.one',
		params: {},
	});
	await nextTick();

	await withTestTimeout(client.dispose(), 100);

	assert.equal(closeSignal instanceof AbortSignal, true);
	assert.equal(closeSignal?.aborted, true);
	assert.deepEqual(await withTestTimeout(resultPromise), {
		success: false,
		output: '',
		error: 'mdev bridge client disposed.',
	});
	assert.equal(typeof onEvent, 'function');
});

void test('dispose during pending startup settles run and closes late stream', async () => {
	const unhandledRejections: unknown[] = [];
	const onUnhandledRejection = (reason: unknown) => {
		unhandledRejections.push(reason);
	};
	let capturedStart:
		| {
				command: string;
				abortSignal: AbortSignal | undefined;
		  }
		| undefined;
	let resolveStart:
		| ((stream: {
				sendData: (data: ArrayBuffer) => Promise<void>;
				close: (opts?: { signal?: AbortSignal }) => Promise<void>;
		  }) => void)
		| undefined;
	const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];
	const connection: MdevBridgeStreamConnection = {
		startCommandStream: async (opts) => {
			capturedStart = {
				command: opts.command,
				abortSignal: opts.abortSignal,
			};
			return await new Promise((resolve) => {
				resolveStart = resolve;
			});
		},
	};
	const client = createMdevBridgeClient({
		connection,
		requiredOperations: ['op.one'],
		requestTimeoutMs: 100,
	});

	process.on('unhandledRejection', onUnhandledRejection);
	try {
		const resultPromise = client.runOperation({
			operation: 'op.one',
			params: {},
		});
		await nextTick();

		const disposePromise = client.dispose();

		assert.equal(capturedStart?.command, EXPECTED_MDEV_BRIDGE_COMMAND);
		assert.equal(capturedStart?.abortSignal instanceof AbortSignal, true);
		assert.equal(capturedStart?.abortSignal?.aborted, true);
		assert.deepEqual(await withTestTimeout(resultPromise), {
			success: false,
			output: '',
			error: 'mdev bridge client disposed.',
		});
		await withTestTimeout(disposePromise);

		assert.ok(resolveStart, 'start promise resolver was not captured');
		resolveStart({
			sendData: async () => {},
			close: async (opts) => {
				closeOptions.push(opts);
				throw new Error('late startup close failed');
			},
		});
		await waitTimeout(20);

		assert.equal(closeOptions.length, 1);
		assert.equal(closeOptions[0]?.signal instanceof AbortSignal, true);
		assert.deepEqual(unhandledRejections, []);
	} finally {
		process.off('unhandledRejection', onUnhandledRejection);
	}
});
