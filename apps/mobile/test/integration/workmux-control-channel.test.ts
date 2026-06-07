import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createWorkmuxControlChannel,
	disposeWorkmuxControlChannelAfterCleanup,
	type WorkmuxControlCommandResult,
} from '../../src/lib/workmux-control-channel';
import { type MdevBridgeClient } from '../../src/lib/mdev-bridge-client';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function createRecordingBridgeClient(
	result: WorkmuxControlCommandResult = { success: true, output: 'ok\n' },
) {
	const calls: Array<{
		operation: string;
		params: Record<string, unknown>;
		timeoutMs?: number;
	}> = [];
	let disposeCount = 0;
	const bridgeClient: MdevBridgeClient = {
		runOperation: async (input) => {
			calls.push(input);
			return result;
		},
		dispose: async () => {
			disposeCount += 1;
		},
	};
	return { bridgeClient, calls, getDisposeCount: () => disposeCount };
}

void test('WorkmuxControlChannel.command routes mapped argv through bridge operations, preserving timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command(
		['tmux', 'app', 'nav', 'next-all', '--session', 'main'],
		{ timeoutMs: 1234 },
	);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.app.nav',
			params: { action: 'next-all', session: 'main' },
			timeoutMs: 1234,
		},
	]);
});

void test('WorkmuxControlChannel.command uses default bridge timeout', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
	});

	await channel.command(['tmux', 'nav', 'cycle', 'main:']);

	assert.deepEqual(bridge.calls, [
		{
			operation: 'tmux.nav',
			params: { action: 'cycle', target: 'main:' },
			timeoutMs: 10_000,
		},
	]);
});

void test('WorkmuxControlChannel.command rejects unsupported argv locally without bridge', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
	});

	const result = await channel.command([
		'tmux',
		'app',
		'scroll',
		'line-down',
		'--session',
		'main',
	]);

	assert.equal(result.success, false);
	assert.equal(result.output, '');
	assert.match(result.error ?? '', /Unsupported Workmux bridge command/);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel.scroll delegates to DirectMux transport', async () => {
	const sent: string[] = [];
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async (command) => {
				sent.push(command);
				return true;
			},
			dispose: async () => {
				sent.push('__disposed__');
			},
		},
	});

	assert.deepEqual(await channel.scroll.enter({ sessionName: 'main' }), {
		success: true,
		output: '',
	});
	assert.deepEqual(
		await channel.scroll.move({
			sessionName: 'main',
			direction: 'down',
			unit: 'line',
			count: 4,
		}),
		{ success: true, output: '' },
	);
	assert.deepEqual(await channel.scroll.exit({ sessionName: 'main' }), {
		success: true,
		output: '',
	});
	await channel.dispose();

	assert.deepEqual(sent, [
		'tmux copy-mode -t main',
		'tmux send-keys -t main -N 4 -X scroll-down',
		'tmux send-keys -t main -X cancel',
		'__disposed__',
	]);
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel.scroll reports failed DirectMux send', async () => {
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: createRecordingBridgeClient().bridgeClient,
		directTmuxTransport: {
			send: async () => false,
			dispose: async () => {},
		},
	});

	const result: WorkmuxControlCommandResult = await channel.scroll.exit({
		sessionName: 'main',
	});

	assert.deepEqual(result, {
		success: false,
		output: '',
		error: 'DirectMux control unavailable.',
	});
});

void test('WorkmuxControlChannel.dispose delegates to bridge and DirectMux transports', async () => {
	const bridge = createRecordingBridgeClient();
	let directMuxDisposeCount = 0;
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {
				directMuxDisposeCount += 1;
			},
		},
	});

	await channel.dispose();

	assert.equal(bridge.getDisposeCount(), 1);
	assert.equal(directMuxDisposeCount, 1);
});

void test('WorkmuxControlChannel rejects commands after dispose', async () => {
	const bridge = createRecordingBridgeClient();
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: bridge.bridgeClient,
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {},
		},
	});

	await channel.dispose();

	assert.deepEqual(await channel.command(['tmux', 'app', 'nav', 'next']), {
		success: false,
		output: '',
		error: 'Workmux control channel disposed.',
	});
	assert.deepEqual(bridge.calls, []);
});

void test('WorkmuxControlChannel rejects scroll after dispose', async () => {
	const sent: string[] = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		bridgeClient: createRecordingBridgeClient().bridgeClient,
		directTmuxTransport: {
			send: async (command) => {
				sent.push(command);
				return true;
			},
			dispose: async () => {},
		},
	});

	await channel.dispose();

	assert.deepEqual(await channel.scroll.enter({ sessionName: 'main' }), {
		success: false,
		output: '',
		error: 'Workmux control channel disposed.',
	});
	assert.deepEqual(
		await channel.scroll.move({
			sessionName: 'main',
			direction: 'down',
			unit: 'line',
			count: 0,
		}),
		{
			success: false,
			output: '',
			error: 'Workmux control channel disposed.',
		},
	);
	assert.deepEqual(sent, []);
});

void test('disposeWorkmuxControlChannelAfterCleanup waits for scrollback cleanup', async () => {
	const cleanup = deferred<void>();
	const events: string[] = [];

	disposeWorkmuxControlChannelAfterCleanup({
		cleanup: cleanup.promise,
		dispose: async () => {
			events.push('dispose');
		},
	});

	await settle();
	assert.deepEqual(events, []);

	cleanup.resolve();
	await cleanup.promise;
	await settle();

	assert.deepEqual(events, ['dispose']);
});

void test('disposeWorkmuxControlChannelAfterCleanup disposes after failed cleanup', async () => {
	const cleanup = deferred<void>();
	const events: string[] = [];

	disposeWorkmuxControlChannelAfterCleanup({
		cleanup: cleanup.promise,
		dispose: async () => {
			events.push('dispose');
		},
		onCleanupError: (error) => {
			events.push(`cleanup:${String(error)}`);
		},
	});

	cleanup.reject('exit failed');
	await cleanup.promise.catch(() => {});
	await settle();

	assert.deepEqual(events, ['cleanup:exit failed', 'dispose']);
});
