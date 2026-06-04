import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createWorkmuxControlChannel,
	formatMdevArgvCommand,
	type WorkmuxControlCommandResult,
} from '../../src/lib/workmux-control-channel';

void test('formatMdevArgvCommand shell-quotes argv safely', () => {
	assert.equal(
		formatMdevArgvCommand(['tmux', 'app', 'focus', "co'dex"]),
		"mdev tmux app focus 'co'\\''dex'",
	);
	assert.equal(
		formatMdevArgvCommand([
			'tmux',
			'app',
			'notification',
			'open',
			'--session',
			'--looks-like-flag',
			'--window-id',
			'$(bad)',
		]),
		"mdev tmux app notification 'open' '--session' '--looks-like-flag' '--window-id' '$(bad)'",
	);
	assert.equal(
		formatMdevArgvCommand(['tmux', '--bad', '$(bad)', 'next']),
		"mdev tmux '--bad' '$(bad)' 'next'",
	);
});

void test('WorkmuxControlChannel.command uses one-shot mdev fallback with default timeout', async () => {
	const calls: Array<{ command: string; timeoutMs: number }> = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async (command, timeoutMs) => {
			calls.push({ command, timeoutMs });
			return { success: true, output: 'ok\n' };
		},
	});

	const result = await channel.command(['tmux', 'app', 'nav', 'next']);

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(calls, [
		{ command: "mdev tmux app nav 'next'", timeoutMs: 10_000 },
	]);
});

void test('WorkmuxControlChannel.command uses custom timeout', async () => {
	const calls: Array<{ command: string; timeoutMs: number }> = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async (command, timeoutMs) => {
			calls.push({ command, timeoutMs });
			return { success: true, output: 'ok\n' };
		},
	});

	await channel.command(['tmux', 'app', 'nav', 'next-all'], {
		timeoutMs: 1234,
	});

	assert.deepEqual(calls, [
		{ command: "mdev tmux app nav 'next-all'", timeoutMs: 1234 },
	]);
});

void test('WorkmuxControlChannel.scroll delegates to DirectMux transport', async () => {
	const sent: string[] = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async () => ({ success: true, output: '' }),
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
});

void test('WorkmuxControlChannel.scroll reports failed DirectMux send', async () => {
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async () => ({ success: true, output: '' }),
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

void test('WorkmuxControlChannel.dispose delegates to DirectMux transport', async () => {
	let disposeCount = 0;
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async () => ({ success: true, output: '' }),
		directTmuxTransport: {
			send: async () => true,
			dispose: async () => {
				disposeCount += 1;
			},
		},
	});

	await channel.dispose();

	assert.equal(disposeCount, 1);
});
