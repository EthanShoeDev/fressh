import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import { startRemoteJsonlListener } from '../../src/lib/remote-jsonl-listener';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

type Event =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 100) {
	return await Promise.race([
		promise,
		waitTimeout(timeoutMs).then(() => {
			throw new Error(`test timed out after ${timeoutMs}ms`);
		}),
	]);
}

function createConnection(options?: {
	startCommandStream?: (
		opts: { command: string; onEvent: (event: Event) => void },
		asyncOpts?: { signal?: AbortSignal },
	) => Promise<{ close: (opts?: { signal?: AbortSignal }) => Promise<void> }>;
	close?: (opts?: { signal?: AbortSignal }) => Promise<void>;
}) {
	let onEvent: ((event: Event) => void) | null = null;
	let closed = 0;
	const starts: { command: string; signal: AbortSignal | undefined }[] = [];
	const closeOptions: ({ signal?: AbortSignal } | undefined)[] = [];
	return {
		starts,
		closeOptions,
		get closed() {
			return closed;
		},
		emit(event: Event) {
			onEvent?.(event);
		},
		connection: {
			startCommandStream: async (
				opts: { command: string; onEvent: (event: Event) => void },
				asyncOpts?: { signal?: AbortSignal },
			) => {
				starts.push({ command: opts.command, signal: asyncOpts?.signal });
				onEvent = opts.onEvent;
				if (options?.startCommandStream) {
					return options.startCommandStream(opts, asyncOpts);
				}
				return {
					close: async (closeOpts?: { signal?: AbortSignal }) => {
						closeOptions.push(closeOpts);
						if (options?.close) {
							await options.close(closeOpts);
							return;
						}
						closed += 1;
					},
				};
			},
		},
	};
}

void test('startRemoteJsonlListener starts a streaming command and splits stdout lines', async () => {
	const fixture = createConnection();
	const lines: string[] = [];
	const stderr: string[] = [];

	const handle = await startRemoteJsonlListener({
		connection: fixture.connection,
		command: 'mdev tmux notifications listen --session main',
		onLine: (line) => lines.push(line),
		onStderr: (line) => stderr.push(line),
		onExit: () => {},
	});

	assert.deepEqual(fixture.starts, [
		{
			command: 'mdev tmux notifications listen --session main',
			signal: fixture.starts[0]?.signal,
		},
	]);
	assert.equal(fixture.starts[0]?.signal instanceof AbortSignal, true);

	fixture.emit({ type: 'stdout', bytes: bytes('{"a":1}\n{"b"') });
	fixture.emit({ type: 'stdout', bytes: bytes(':2}\r\n') });
	fixture.emit({ type: 'stderr', bytes: bytes('warn\n') });

	assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
	assert.deepEqual(stderr, ['warn']);

	await handle.stop();
	assert.equal(fixture.closed, 1);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
});

void test('startRemoteJsonlListener reports stream closure once', async () => {
	const fixture = createConnection();
	const exits: unknown[] = [];

	const handle = await startRemoteJsonlListener({
		connection: fixture.connection,
		command: 'listen',
		onLine: () => {},
		onExit: (error) => exits.push(error),
	});

	fixture.emit({ type: 'closed' });
	fixture.emit({ type: 'closed' });

	assert.deepEqual(exits, [undefined]);
	await handle.stop();
	assert.equal(fixture.closed, 0);
});

void test('startRemoteJsonlListener reports nonzero status and exit signals once', async () => {
	const statusFixture = createConnection();
	const statusExits: unknown[] = [];
	const statusHandle = await startRemoteJsonlListener({
		connection: statusFixture.connection,
		command: 'listen',
		onLine: () => {},
		onExit: (error) => statusExits.push(error),
	});

	statusFixture.emit({ type: 'exitStatus', exitStatus: 2 });
	statusFixture.emit({ type: 'exitSignal', signalName: 'TERM' });
	await waitTimeout(0);

	assert.match(String(statusExits[0]), /Remote stream exited with status 2/);
	assert.equal(statusExits.length, 1);
	assert.equal(statusFixture.closed, 1);
	await statusHandle.stop();
	assert.equal(statusFixture.closed, 1);

	const signalFixture = createConnection();
	const signalExits: unknown[] = [];
	const signalHandle = await startRemoteJsonlListener({
		connection: signalFixture.connection,
		command: 'listen',
		onLine: () => {},
		onExit: (error) => signalExits.push(error),
	});

	signalFixture.emit({ type: 'exitSignal', signalName: 'TERM' });
	await waitTimeout(0);

	assert.match(String(signalExits[0]), /Remote stream exited with signal TERM/);
	assert.equal(signalFixture.closed, 1);
	await signalHandle.stop();
	assert.equal(signalFixture.closed, 1);
});

void test('startRemoteJsonlListener reports line handler failures and stops processing', async () => {
	const fixture = createConnection();
	const error = new Error('parse failed');
	const exits: unknown[] = [];

	const handle = await startRemoteJsonlListener({
		connection: fixture.connection,
		command: 'listen',
		onLine: () => {
			throw error;
		},
		onExit: (exitError) => exits.push(exitError),
	});

	fixture.emit({ type: 'stdout', bytes: bytes('{"bad":true}\n') });
	fixture.emit({ type: 'stdout', bytes: bytes('{"after":"failure"}\n') });
	await waitTimeout(0);

	assert.deepEqual(exits, [error]);
	await handle.stop();
	assert.equal(fixture.closed, 1);
});

void test('startRemoteJsonlListener still closes after exit handler failure', async () => {
	const fixture = createConnection();
	const warn = mock.method(console, 'warn', () => {});
	const handle = await startRemoteJsonlListener({
		connection: fixture.connection,
		command: 'listen',
		onLine: () => {},
		onExit: () => {
			throw new Error('exit handler failed');
		},
	});

	fixture.emit({ type: 'exitStatus', exitStatus: 2 });
	await waitTimeout(0);

	assert.equal(fixture.closed, 1);
	assert.equal(warn.mock.callCount(), 1);
	assert.match(
		String(warn.mock.calls[0]?.arguments[0]),
		/remote JSONL listener exit handler failed/,
	);
	await handle.stop();
	assert.equal(fixture.closed, 1);
});

void test('startRemoteJsonlListener aborts slow start and logs slow close', async () => {
	const fixture = createConnection({
		startCommandStream: async (_opts, asyncOpts) => {
			assert.equal(asyncOpts?.signal instanceof AbortSignal, true);
			return new Promise(() => {});
		},
	});

	await assert.rejects(
		withTestTimeout(
			startRemoteJsonlListener({
				connection: fixture.connection,
				command: 'listen',
				operationTimeoutMs: 5,
				onLine: () => {},
				onExit: () => {},
			}),
		),
		/Remote JSONL listener operation timed out/,
	);
	assert.equal(fixture.starts[0]?.signal?.aborted, true);

	const warn = mock.method(console, 'warn', () => {});
	const closeFixture = createConnection({
		close: async (opts) => {
			assert.equal(opts?.signal instanceof AbortSignal, true);
			return new Promise(() => {});
		},
	});
	const handle = await startRemoteJsonlListener({
		connection: closeFixture.connection,
		command: 'listen',
		operationTimeoutMs: 5,
		onLine: () => {},
		onExit: () => {},
	});

	await handle.stop();

	assert.equal(closeFixture.closeOptions[0]?.signal?.aborted, true);
	assert.equal(warn.mock.callCount(), 1);
});
