import assert from 'node:assert/strict';
import test from 'node:test';
import { runHostCommandWithBoundary } from '../../src/lib/host-command-router';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

void test('runHostCommandWithBoundary sends Workmux app commands to bridge argv transport', async () => {
	const calls: { argv: string[]; timeoutMs: number }[] = [];
	const output = await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: "mdev tmux app window --session 'main'",
		timeoutMs: 10_000,
		runWorkmuxCommand: async (_connection, argv, timeoutMs) => {
			calls.push({ argv, timeoutMs });
			return '{"windowId":"@12"}';
		},
		executeSideChannelCommand: async () => {
			throw new Error('side channel should not run');
		},
	});

	assert.equal(output, '{"windowId":"@12"}');
	assert.deepEqual(calls, [
		{ argv: ['tmux', 'app', 'window', '--session', 'main'], timeoutMs: 10_000 },
	]);
});

void test('runHostCommandWithBoundary parses quoted Workmux app command values', async () => {
	const calls: string[][] = [];
	await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: "mdev tmux app focus 'don'\\''t' --session 'main session'",
		timeoutMs: 10_000,
		runWorkmuxCommand: async (_connection, argv) => {
			calls.push(argv);
			return '';
		},
		executeSideChannelCommand: async () => {
			throw new Error('side channel should not run');
		},
	});

	assert.deepEqual(calls, [
		['tmux', 'app', 'focus', "don't", '--session', 'main session'],
	]);
});

void test('runHostCommandWithBoundary preserves side channel for non-Workmux commands', async () => {
	const calls: string[] = [];
	const output = await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: 'git remote get-url origin',
		timeoutMs: 20_000,
		executeSideChannelCommand: async (_connection, command, timeoutMs) => {
			calls.push(`side:${command}:${timeoutMs}`);
			return { success: true, output: 'git@github.com:mulyoved/fressh.git\n' };
		},
	});

	assert.equal(output, 'git@github.com:mulyoved/fressh.git');
	assert.deepEqual(calls, ['side:git remote get-url origin:20000']);
});

void test('runHostCommandWithBoundary tells users to update mdev for old Workmux command failures', async () => {
	await assert.rejects(
		runHostCommandWithBoundary({
			connection: { id: 'conn' },
			command: "mdev tmux app context --session 'main'",
			timeoutMs: 10_000,
			runWorkmuxCommand: async () => {
				throw new Error('Unknown tmux command: nav');
			},
			executeSideChannelCommand: async () => {
				throw new Error('side channel should not run');
			},
		}),
		(error) =>
			error instanceof Error &&
			error.message === WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
});

void test('runHostCommandWithBoundary throws side-channel failures', async () => {
	await assert.rejects(
		runHostCommandWithBoundary({
			connection: { id: 'conn' },
			command: 'git status',
			timeoutMs: 10_000,
			executeSideChannelCommand: async () => ({
				success: false,
				output: '',
				error: 'Remote command failed.',
			}),
		}),
		/Remote command failed/,
	);
});
