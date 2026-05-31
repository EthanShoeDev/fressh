import assert from 'node:assert/strict';
import test from 'node:test';

import {
	finishDetectedOpenRequest,
	getDetectedOpenTimeoutMs,
	runDetectedOpenCommand,
	tryBeginDetectedOpenRequest,
} from '../../src/lib/detected-open-actions';

void test('detected open timeout is 30 seconds for auto mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('auto'), 30_000);
});

void test('detected open timeout is 60 seconds for pick mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('pick'), 60_000);
});

void test('detected open request begins when no request is in flight', () => {
	const inFlightRef = { current: false };
	const busyCalls: string[] = [];

	const didBegin = tryBeginDetectedOpenRequest({
		inFlightRef,
		onBusy: () => busyCalls.push('busy'),
	});

	assert.equal(didBegin, true);
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(busyCalls, []);
});

void test('detected open request reports busy when already in flight', () => {
	const inFlightRef = { current: true };
	let busyCalls = 0;

	const didBegin = tryBeginDetectedOpenRequest({
		inFlightRef,
		onBusy: () => {
			busyCalls += 1;
		},
	});

	assert.equal(didBegin, false);
	assert.equal(busyCalls, 1);
	assert.equal(inFlightRef.current, true);
});

void test('detected open request finish clears in-flight state', () => {
	const inFlightRef = { current: true };
	let busyCalls = 0;

	finishDetectedOpenRequest(inFlightRef);

	assert.equal(inFlightRef.current, false);
	assert.equal(
		tryBeginDetectedOpenRequest({
			inFlightRef,
			onBusy: () => {
				busyCalls += 1;
			},
		}),
		true,
	);
	assert.equal(inFlightRef.current, true);
	assert.equal(busyCalls, 0);
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
