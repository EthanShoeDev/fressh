import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import {
	MDEV_BRIDGE_UPDATE_MESSAGE,
	createMdevBridgeClient,
	type MdevBridgeStreamConnection,
	type MdevBridgeStreamEvent,
} from '../../src/lib/mdev-bridge-client';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function text(bytes: ArrayBuffer): string {
	return new TextDecoder().decode(bytes);
}

async function nextTick() {
	await waitTimeout(0);
}

function parseWrite(write: string): unknown {
	assert.match(write, /\n$/);
	return JSON.parse(write);
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
			command: 'mdev bridge --jsonl',
			abortSignal: fixture.starts[0]?.abortSignal,
		},
	]);
	assert.equal(fixture.starts[0]?.abortSignal instanceof AbortSignal, true);
	assert.equal(fixture.writes.length, 1);
	assert.deepEqual(parseWrite(fixture.writes[0] ?? ''), {
		id: 'mdev-bridge-1',
		type: 'hello',
	});

	fixture.emitJson(helloResponse());
	await nextTick();

	assert.equal(fixture.writes.length, 2);
	assert.deepEqual(parseWrite(fixture.writes[1] ?? ''), {
		id: 'mdev-bridge-2',
		type: 'operation',
		operation: 'op.one',
		params: { target: 'pane' },
		timeoutMs: 250,
	});

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
	assert.deepEqual(parseWrite(fixture.writes[1] ?? ''), {
		id: 'mdev-bridge-2',
		type: 'operation',
		operation: 'op.one',
		params: { order: 1 },
		timeoutMs: 100,
	});

	fixture.emitJson({ id: 'mdev-bridge-2', ok: true, result: { order: 1 } });
	assert.deepEqual(await firstResultPromise, {
		success: true,
		output: '{"order":1}\n',
	});
	await nextTick();

	assert.equal(fixture.writes.length, 3);
	assert.deepEqual(parseWrite(fixture.writes[2] ?? ''), {
		id: 'mdev-bridge-3',
		type: 'operation',
		operation: 'op.two',
		params: { order: 2 },
		timeoutMs: 100,
	});

	fixture.emitJson({ id: 'mdev-bridge-3', ok: true, result: { order: 2 } });
	assert.deepEqual(await secondResultPromise, {
		success: true,
		output: '{"order":2}\n',
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
