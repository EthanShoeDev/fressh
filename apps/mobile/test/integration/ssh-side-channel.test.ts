import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
	executeSideChannelCommandCore,
	type SideChannelLogger,
} from '../../src/lib/ssh-side-channel-core';

type Listener = (event: { bytes: ArrayBuffer; stream: 'stdout' }) => void;
type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};
type StartShellOptions = {
	term: 'Xterm';
	useTmux: false;
	tmuxSessionName: '';
	abortSignal?: AbortSignal;
	registerInStore?: false;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const noopLogger: SideChannelLogger = {
	debug: () => {},
	warn: () => {},
	error: () => {},
};

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForMicrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushMicrotasks(count = 5) {
	for (let index = 0; index < count; index += 1) {
		await Promise.resolve();
	}
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

class FakeSideShell {
	channelId = 9;
	closed = false;
	removedListenerId: bigint | null = null;
	sendSignal: AbortSignal | undefined;
	closeSignal: AbortSignal | undefined;
	private listener: Listener | null = null;

	constructor(
		private readonly options: {
			send?: (bytes: ArrayBuffer) => Promise<void>;
			remove?: () => void;
			close?: () => Promise<void>;
		} = {},
	) {}

	addListener(listener: Listener) {
		this.listener = listener;
		return 1n;
	}

	removeListener(listenerId: bigint) {
		this.removedListenerId = listenerId;
		this.options.remove?.();
	}

	async sendData(bytes: ArrayBuffer, opts?: { signal?: AbortSignal }) {
		this.sendSignal = opts?.signal;
		if (this.options.send) {
			await this.options.send(bytes);
			return;
		}
		const command = decoder.decode(bytes);
		const marker = command.match(/__SIDE_CHANNEL_DONE_\d+__/)?.[0];
		if (!marker) throw new Error('missing marker');
		this.listener?.({
			stream: 'stdout',
			bytes: encoder.encode(`${command}hello\n${marker}\nEXIT_CODE:0\n`)
				.buffer as ArrayBuffer,
		});
	}

	async close(opts?: { signal?: AbortSignal }) {
		this.closeSignal = opts?.signal;
		this.closed = true;
		if (this.options.close) await this.options.close();
	}
}

void test('executeSideChannelCommand captures output and closes the side shell', async () => {
	const shell = new FakeSideShell();
	let startShellOptions: StartShellOptions | null = null;
	const connection = {
		startShell: async (options: StartShellOptions) => {
			startShellOptions = options;
			return shell;
		},
	};

	const result = await executeSideChannelCommandCore({
		connection,
		command: 'echo hi',
		timeoutMs: 500,
		logger: noopLogger,
	});

	assert.deepEqual(result, {
		success: true,
		output: 'hello',
		error: undefined,
		issueUrl: undefined,
	});
	assert.ok(startShellOptions);
	const capturedStartShellOptions: StartShellOptions = startShellOptions;
	assert.deepEqual(capturedStartShellOptions, {
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
		abortSignal: capturedStartShellOptions.abortSignal,
		registerInStore: false,
	});
	assert.equal(
		capturedStartShellOptions.abortSignal instanceof AbortSignal,
		true,
	);
	assert.equal(shell.removedListenerId, 1n);
	assert.equal(shell.closed, true);
	assert.equal(shell.sendSignal instanceof AbortSignal, true);
	assert.equal(shell.closeSignal instanceof AbortSignal, true);
});

void test('executeSideChannelCommand rejects a hanging shell start', async () => {
	let startSignal: AbortSignal | undefined;
	const connection = {
		startShell: (options: StartShellOptions) => {
			startSignal = options.abortSignal;
			return new Promise<never>(() => {});
		},
	};

	const startedAt = Date.now();
	await assert.rejects(
		executeSideChannelCommandCore({
			connection,
			command: 'echo hi',
			timeoutMs: 25,
			logger: noopLogger,
		}),
		/Command timed out/,
	);
	const elapsedMs = Date.now() - startedAt;

	assert.ok(elapsedMs < 500);
	assert.equal(startSignal?.aborted, true);
});

void test('executeSideChannelCommand rejects shell start failures', async () => {
	const connection = {
		startShell: async () => {
			throw new Error('start failed');
		},
	};

	await assert.rejects(
		executeSideChannelCommandCore({
			connection,
			command: 'echo hi',
			timeoutMs: 500,
			logger: noopLogger,
		}),
		/start failed/,
	);
});

void test('executeSideChannelCommand closes a shell that resolves after start timeout', async () => {
	const deferred = createDeferred<FakeSideShell>();
	const shell = new FakeSideShell();
	const connection = {
		startShell: () => deferred.promise,
	};

	await assert.rejects(
		executeSideChannelCommandCore({
			connection,
			command: 'echo hi',
			timeoutMs: 25,
			logger: noopLogger,
		}),
		/Command timed out/,
	);

	deferred.resolve(shell);
	await waitForMicrotask();

	assert.equal(shell.closed, true);
	assert.equal(shell.closeSignal instanceof AbortSignal, true);
});

void test('executeSideChannelCommand bounds hanging send and close operations', async () => {
	const sendShell = new FakeSideShell({
		send: () => new Promise<never>(() => {}),
	});
	const sendResult = await executeSideChannelCommandCore({
		connection: { startShell: async () => sendShell },
		command: 'echo hi',
		timeoutMs: 25,
		logger: noopLogger,
	});
	assert.equal(sendResult.success, false);
	assert.equal(sendResult.error, 'Command timed out');
	assert.equal(sendShell.removedListenerId, 1n);
	assert.equal(sendShell.closed, true);
	assert.equal(sendShell.sendSignal?.aborted, true);

	const closeShell = new FakeSideShell({
		close: async () => {
			await delay(5_000);
		},
	});
	const startedAt = Date.now();
	const closeResult = await executeSideChannelCommandCore({
		connection: { startShell: async () => closeShell },
		command: 'echo hi',
		timeoutMs: 25,
		logger: noopLogger,
	});
	const elapsedMs = Date.now() - startedAt;

	assert.equal(closeResult.success, true);
	assert.ok(elapsedMs < 1_500);
	assert.equal(closeShell.removedListenerId, 1n);
	assert.equal(closeShell.closed, true);
	assert.equal(closeShell.closeSignal?.aborted, true);
});

void test('executeSideChannelCommand allows normal close above 100ms', async () => {
	const closeShell = new FakeSideShell({
		close: async () => {
			await delay(150);
		},
	});
	const result = await executeSideChannelCommandCore({
		connection: { startShell: async () => closeShell },
		command: 'echo hi',
		timeoutMs: 500,
		logger: noopLogger,
	});

	assert.equal(result.success, true);
	assert.equal(closeShell.closed, true);
	assert.equal(closeShell.closeSignal?.aborted, false);
});

void test('executeSideChannelCommand uses cleanup budget after command timeout', async (t) => {
	mock.timers.enable({ apis: ['setTimeout'], now: 0 });
	t.after(() => {
		mock.timers.reset();
	});
	const closeShell = new FakeSideShell({
		send: () => new Promise<never>(() => {}),
		close: () => new Promise<never>(() => {}),
	});
	const resultPromise = executeSideChannelCommandCore({
		connection: { startShell: async () => closeShell },
		command: 'echo hi',
		timeoutMs: 25,
		logger: noopLogger,
	});

	await flushMicrotasks();
	mock.timers.tick(25);
	await flushMicrotasks();

	assert.equal(closeShell.closed, true);
	assert.equal(closeShell.closeSignal?.aborted, false);

	mock.timers.tick(999);
	await flushMicrotasks();

	assert.equal(closeShell.closeSignal?.aborted, false);

	mock.timers.tick(1);
	const result = await resultPromise;

	assert.equal(result.success, false);
	assert.equal(result.error, 'Command timed out');
	assert.equal(closeShell.removedListenerId, 1n);
	assert.equal(closeShell.sendSignal?.aborted, true);
	assert.equal(closeShell.closeSignal?.aborted, true);
});

void test('executeSideChannelCommand closes shell when listener removal fails', async () => {
	const shell = new FakeSideShell({
		remove: () => {
			throw new Error('remove failed');
		},
	});

	const result = await executeSideChannelCommandCore({
		connection: { startShell: async () => shell },
		command: 'echo hi',
		timeoutMs: 500,
		logger: noopLogger,
	});

	assert.equal(result.success, true);
	assert.equal(shell.removedListenerId, 1n);
	assert.equal(shell.closed, true);
});

void test('executeSideChannelCommand bounds waiting for command output marker', async () => {
	const shell = new FakeSideShell({
		send: async () => {},
	});
	const startedAt = Date.now();
	const result = await executeSideChannelCommandCore({
		connection: { startShell: async () => shell },
		command: 'echo hi',
		timeoutMs: 25,
		logger: noopLogger,
	});
	const elapsedMs = Date.now() - startedAt;

	assert.equal(result.success, false);
	assert.equal(result.error, 'Command timed out');
	assert.ok(elapsedMs < 500);
	assert.equal(shell.removedListenerId, 1n);
	assert.equal(shell.closed, true);
});
