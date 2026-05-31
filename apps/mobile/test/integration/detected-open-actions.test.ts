import assert from 'node:assert/strict';
import test from 'node:test';

import {
	finishDetectedOpenRequest,
	getDetectedOpenTimeoutMs,
	planDetectedOpenShortcutPress,
	resolveDetectedOpenShortcutMode,
	runDetectedOpenCallback,
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

void test('detected open callback runs auto target only', () => {
	const calls: string[] = [];

	const result = runDetectedOpenCallback('auto', {
		onOpenDetectedAuto: () => {
			calls.push('auto');
			return true;
		},
		onOpenDetectedPick: () => {
			calls.push('pick');
			return false;
		},
	});

	assert.equal(result, true);
	assert.deepEqual(calls, ['auto']);
});

void test('detected open callback runs pick target only', () => {
	const calls: string[] = [];

	const result = runDetectedOpenCallback('pick', {
		onOpenDetectedAuto: () => {
			calls.push('auto');
			return true;
		},
		onOpenDetectedPick: () => {
			calls.push('pick');
			return false;
		},
	});

	assert.equal(result, false);
	assert.deepEqual(calls, ['pick']);
});

void test('detected open shortcut resolves browser keyboard bytes', () => {
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		'auto',
	);
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 65],
		}),
		'pick',
	);
});

void test('detected open shortcut ignores other keyboard items', () => {
	assert.equal(
		resolveDetectedOpenShortcutMode('base_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		null,
	);
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 66],
		}),
		null,
	);
	assert.equal(
		resolveDetectedOpenShortcutMode('browser_keyboard', {
			type: 'action',
		}),
		null,
	);
});

void test('detected open shortcut press plans guarded actions for browser keyboard bytes', () => {
	assert.deepEqual(
		planDetectedOpenShortcutPress('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		{ type: 'action', actionId: 'OPEN_HOST_DETECTED_AUTO' },
	);
	assert.deepEqual(
		planDetectedOpenShortcutPress('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 65],
		}),
		{ type: 'action', actionId: 'OPEN_HOST_DETECTED_PICK' },
	);
});

void test('detected open shortcut press falls back to raw bytes for nonmatches', () => {
	assert.deepEqual(
		planDetectedOpenShortcutPress('base_keyboard', {
			type: 'bytes',
			bytes: [27, 97],
		}),
		{ type: 'bytes', bytes: [27, 97] },
	);
	assert.deepEqual(
		planDetectedOpenShortcutPress('browser_keyboard', {
			type: 'bytes',
			bytes: [27, 66],
		}),
		{ type: 'bytes', bytes: [27, 66] },
	);
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
