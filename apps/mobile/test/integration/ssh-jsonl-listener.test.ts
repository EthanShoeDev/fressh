import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	setImmediate as waitImmediate,
	setTimeout as waitTimeout,
} from 'node:timers/promises';
import { startSshJsonlListener } from '../../src/lib/ssh-jsonl-listener';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function splitBytes(text: string, splitAt: number): [ArrayBuffer, ArrayBuffer] {
	const encoded = new TextEncoder().encode(text);
	return [
		encoded.slice(0, splitAt).buffer as ArrayBuffer,
		encoded.slice(splitAt).buffer as ArrayBuffer,
	];
}

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 100) {
	return await Promise.race([
		promise,
		waitTimeout(timeoutMs).then(() => {
			throw new Error(`test timed out after ${timeoutMs}ms`);
		}),
	]);
}

type TestEvent =
	| { bytes: ArrayBuffer; stream: 'stdout' | 'stderr' }
	| { fromSeq: bigint; toSeq: bigint };
type TestListener = (event: TestEvent) => void;
type TestStartShellOptions = {
	term: string;
	useTmux: boolean;
	tmuxSessionName: string;
	onClosed?: () => void;
	abortSignal?: AbortSignal;
	registerInStore?: boolean;
};
type TestOperationOptions = { signal?: AbortSignal };

function createTestConnection(options?: {
	addListener?: (cb: TestListener) => bigint;
	removeListener?: (id: bigint) => void;
	sendData?: (data: ArrayBuffer, opts?: TestOperationOptions) => Promise<void>;
	close?: (opts?: TestOperationOptions) => Promise<void>;
	startShell?: (input: TestStartShellOptions) => Promise<unknown>;
	onStartShell?: (input: TestStartShellOptions) => void;
}) {
	const sent: string[] = [];
	const sendOptions: (TestOperationOptions | undefined)[] = [];
	const closeOptions: (TestOperationOptions | undefined)[] = [];
	const removed: bigint[] = [];
	const startShellOptions: TestStartShellOptions[] = [];
	let listener: TestListener | null = null;
	let closed = 0;

	const shell = {
		channelId: 7,
		addListener:
			options?.addListener ??
			((cb: TestListener) => {
				listener = cb;
				return 99n;
			}),
		removeListener:
			options?.removeListener ??
			((id: bigint) => {
				removed.push(id);
			}),
		sendData: async (data: ArrayBuffer, opts?: TestOperationOptions) => {
			sendOptions.push(opts);
			if (options?.sendData) {
				await options.sendData(data, opts);
			} else {
				sent.push(new TextDecoder().decode(data));
			}
		},
		close: async (opts?: TestOperationOptions) => {
			closeOptions.push(opts);
			if (options?.close) {
				await options.close(opts);
			} else {
				closed += 1;
			}
		},
	};

	const connection = {
		startShell: async (input: TestStartShellOptions) => {
			startShellOptions.push(input);
			options?.onStartShell?.(input);
			if (options?.startShell) return options.startShell(input);
			return shell;
		},
	};

	return {
		connection,
		emit: (event: TestEvent) => listener?.(event),
		triggerClosed: () => startShellOptions.at(-1)?.onClosed?.(),
		sent,
		sendOptions,
		closeOptions,
		removed,
		get closed() {
			return closed;
		},
		startShellOptions,
	};
}

void test('startSshJsonlListener opens non-tmux shell and sends command', async () => {
	const fixture = createTestConnection();
	const lines: string[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'mdev tmux notifications listen --session main',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	assert.deepEqual(fixture.startShellOptions, [
		{
			term: 'Xterm',
			useTmux: false,
			tmuxSessionName: '',
			onClosed: fixture.startShellOptions[0]?.onClosed,
			abortSignal: fixture.startShellOptions[0]?.abortSignal,
			registerInStore: false,
		},
	]);
	assert.equal(typeof fixture.startShellOptions[0]?.onClosed, 'function');
	assert.equal(
		fixture.startShellOptions[0]?.abortSignal instanceof AbortSignal,
		true,
	);
	assert.deepEqual(fixture.sent, [
		'exec mdev tmux notifications listen --session main\n',
	]);
	assert.equal(fixture.sendOptions[0]?.signal instanceof AbortSignal, true);

	await handle.stop();
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
});

void test('startSshJsonlListener uses exec so command exit closes the hidden shell', async () => {
	const fixture = createTestConnection();

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'mdev tmux notifications listen --session main',
		onLine: () => {},
		onExit: () => {},
	});

	assert.equal(
		fixture.sent[0],
		'exec mdev tmux notifications listen --session main\n',
	);

	await handle.stop();
});

void test('startSshJsonlListener splits stdout chunks and preserves payload spacing', async () => {
	const fixture = createTestConnection();
	const lines: string[] = [];
	const [utf8Start, utf8End] = splitBytes('{"snow":"☃"}\n', 11);

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	fixture.emit({ bytes: bytes('{"a":'), stream: 'stdout' });
	fixture.emit({ bytes: bytes('1}\r\n  \n{"b":2}\n  {"c"'), stream: 'stdout' });
	fixture.emit({ bytes: bytes(':3}\n'), stream: 'stdout' });
	fixture.emit({ bytes: utf8Start, stream: 'stdout' });
	fixture.emit({ bytes: utf8End, stream: 'stdout' });
	fixture.emit({ bytes: bytes('{"ignored":true}\n'), stream: 'stderr' });
	fixture.emit({ fromSeq: 1n, toSeq: 2n });

	assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '  {"c":3}', '{"snow":"☃"}']);

	await handle.stop();
});

void test('startSshJsonlListener removes listener and closes shell on stop', async () => {
	const fixture = createTestConnection();
	const lines: string[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: (line) => lines.push(line),
		onExit: () => {},
	});

	await handle.stop();
	fixture.emit({ bytes: bytes('{"after":"stop"}\n'), stream: 'stdout' });

	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(fixture.closed, 1);
	assert.deepEqual(lines, []);
});

void test('startSshJsonlListener reports send failures through onExit', async () => {
	const error = new Error('send failed');
	const warn = mock.method(console, 'warn', () => {});
	const fixture = createTestConnection({
		sendData: async () => {
			throw error;
		},
	});
	const exits: unknown[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: (exitError) => exits.push(exitError),
	});

	assert.deepEqual(exits, [error]);
	assert.equal(warn.mock.callCount(), 1);
	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(fixture.closed, 1);

	await handle.stop();
	assert.equal(fixture.closed, 1);
});

void test('startSshJsonlListener cleans up if listener attachment fails', async () => {
	const error = new Error('add listener failed');
	const fixture = createTestConnection({
		addListener: () => {
			throw error;
		},
	});

	await assert.rejects(
		startSshJsonlListener({
			connection: fixture.connection as never,
			command: 'listen',
			onLine: () => {},
			onExit: () => {},
		}),
		error,
	);

	assert.equal(fixture.closed, 1);
});

void test('startSshJsonlListener propagates startShell failures', async () => {
	const error = new Error('start shell failed');
	const fixture = createTestConnection({
		startShell: async () => {
			throw error;
		},
	});

	await assert.rejects(
		startSshJsonlListener({
			connection: fixture.connection as never,
			command: 'listen',
			onLine: () => {},
			onExit: () => {},
		}),
		error,
	);

	assert.deepEqual(fixture.sent, []);
	assert.equal(fixture.closed, 0);
});

void test('startSshJsonlListener times out if startShell never settles', async () => {
	const fixture = createTestConnection({
		startShell: async () => new Promise(() => {}),
	});

	await assert.rejects(
		withTestTimeout(
			startSshJsonlListener({
				connection: fixture.connection as never,
				command: 'listen',
				operationTimeoutMs: 5,
				onLine: () => {},
				onExit: () => {},
			}),
		),
		/listener operation timed out/,
	);

	assert.deepEqual(fixture.sent, []);
	assert.equal(fixture.closed, 0);
	assert.equal(fixture.startShellOptions[0]?.abortSignal?.aborted, true);
});

void test('startSshJsonlListener reports send timeout even when close hangs', async () => {
	const warn = mock.method(console, 'warn', () => {});
	const fixture = createTestConnection({
		sendData: async () => new Promise(() => {}),
		close: async () => new Promise(() => {}),
	});
	const exits: unknown[] = [];

	const handle = await withTestTimeout(
		startSshJsonlListener({
			connection: fixture.connection as never,
			command: 'listen',
			operationTimeoutMs: 5,
			onLine: () => {},
			onExit: (exitError) => exits.push(exitError),
		}),
	);

	assert.equal(exits.length, 1);
	assert.match(String(exits[0]), /listener operation timed out/);
	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(fixture.sendOptions[0]?.signal?.aborted, true);
	assert.equal(fixture.closeOptions[0]?.signal instanceof AbortSignal, true);
	assert.equal(fixture.closeOptions[0]?.signal?.aborted, true);
	assert.equal(warn.mock.callCount(), 2);

	await handle.stop();
});

void test('startSshJsonlListener reports line handler failures through onExit', async () => {
	const error = new Error('parse failed');
	const fixture = createTestConnection();
	const exits: unknown[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {
			throw error;
		},
		onExit: (exitError) => exits.push(exitError),
	});

	fixture.emit({ bytes: bytes('{"bad":true}\n'), stream: 'stdout' });
	await waitImmediate();
	fixture.emit({ bytes: bytes('{"after":"failure"}\n'), stream: 'stdout' });

	assert.deepEqual(exits, [error]);
	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(fixture.closed, 1);

	await handle.stop();
	assert.equal(fixture.closed, 1);
});

void test('startSshJsonlListener continues cleanup if listener removal fails', async () => {
	const removeError = new Error('remove failed');
	const warn = mock.method(console, 'warn', () => {});
	const fixture = createTestConnection({
		removeListener: () => {
			throw removeError;
		},
	});
	const exits: unknown[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: (exitError) => exits.push(exitError),
	});

	await handle.stop();

	assert.deepEqual(exits, []);
	assert.equal(fixture.closed, 1);
	assert.equal(warn.mock.calls[0]?.arguments[1], removeError);
});

void test('startSshJsonlListener stops startup if shell closes before command send', async () => {
	const fixture = createTestConnection({
		onStartShell: (input) => input.onClosed?.(),
	});
	const exits: unknown[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: (exitError) => exits.push(exitError),
	});

	assert.deepEqual(exits, [undefined]);
	assert.deepEqual(fixture.sent, []);
	assert.deepEqual(fixture.removed, []);
	assert.equal(fixture.closed, 1);

	await handle.stop();
	assert.equal(fixture.closed, 1);
});

void test('startSshJsonlListener reports shell closure through onExit', async () => {
	const fixture = createTestConnection();
	const exits: unknown[] = [];

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: (exitError) => exits.push(exitError),
	});

	fixture.triggerClosed();

	assert.deepEqual(exits, [undefined]);
	assert.deepEqual(fixture.removed, [99n]);

	await handle.stop();
	assert.equal(fixture.closed, 0);
});

void test('startSshJsonlListener logs and ignores close failures on stop', async () => {
	const closeError = new Error('close failed');
	const warn = mock.method(console, 'warn', () => {});
	const fixture = createTestConnection({
		close: async () => {
			throw closeError;
		},
	});

	const handle = await startSshJsonlListener({
		connection: fixture.connection as never,
		command: 'listen',
		onLine: () => {},
		onExit: () => {},
	});

	await handle.stop();

	assert.deepEqual(fixture.removed, [99n]);
	assert.equal(warn.mock.callCount(), 1);
	assert.equal(warn.mock.calls[0]?.arguments[1], closeError);
});
