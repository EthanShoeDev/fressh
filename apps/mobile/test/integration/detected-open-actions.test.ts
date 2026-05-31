import assert from 'node:assert/strict';
import test from 'node:test';

import {
	getDetectedOpenTimeoutMs,
	runDetectedOpenCommand,
} from '../../src/lib/detected-open-actions';

void test('detected open timeout is 30 seconds for auto mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('auto'), 30_000);
});

void test('detected open timeout is 60 seconds for pick mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('pick'), 60_000);
});

void test('detected open command runs auto mode with pane context', async () => {
	const commands: { command: string; timeoutMs: number }[] = [];

	await runDetectedOpenCommand({
		mode: 'auto',
		resolvePaneContext: async () => ({
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: "/home/muly/work repo's",
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return '';
		},
	});

	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open auto",
			timeoutMs: 30_000,
		},
	]);
});

void test('detected open command runs pick mode with pane context', async () => {
	const commands: { command: string; timeoutMs: number }[] = [];

	await runDetectedOpenCommand({
		mode: 'pick',
		resolvePaneContext: async () => ({
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: '/home/muly/work repo',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return '';
		},
	});

	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo' mdev open pick",
			timeoutMs: 60_000,
		},
	]);
});
