import assert from 'node:assert/strict';
import test from 'node:test';
import { runHostCommandWithBoundary } from '../../src/lib/host-command-router';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	WORKMUX_REMOTE_COMMAND_ENV_PREFIX,
} from '../../src/lib/workmux-app-commands';

void test('runHostCommandWithBoundary sends Workmux app commands to remote exec', async () => {
	const calls: string[] = [];
	const output = await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: "mdev tmux app window --session 'main'",
		timeoutMs: 10_000,
		executeRemoteTextCommand: async (_connection, command, timeoutMs) => {
			calls.push(`remote:${command}:${timeoutMs}`);
			return '{"windowId":"@12"}';
		},
		executeSideChannelCommand: async () => {
			throw new Error('side channel should not run');
		},
	});

	assert.equal(output, '{"windowId":"@12"}');
	assert.deepEqual(calls, [
		`remote:${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} mdev tmux app window --session 'main':10000`,
	]);
});

void test('runHostCommandWithBoundary preserves side channel for non-Workmux commands', async () => {
	const calls: string[] = [];
	const output = await runHostCommandWithBoundary({
		connection: { id: 'conn' },
		command: 'git remote get-url origin',
		timeoutMs: 20_000,
		executeRemoteTextCommand: async () => {
			throw new Error('remote exec should not run');
		},
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
			executeRemoteTextCommand: async () => {
				throw new Error('unrecognized subcommand app');
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
			executeRemoteTextCommand: async () => '',
			executeSideChannelCommand: async () => ({
				success: false,
				output: '',
				error: 'Remote command failed.',
			}),
		}),
		/Remote command failed/,
	);
});
