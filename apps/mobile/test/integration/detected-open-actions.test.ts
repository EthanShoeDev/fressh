import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DETECTED_OPEN_SHORTCUTS,
	finishDetectedOpenRequest,
	getDetectedOpenTimeoutMs,
	planDetectedOpenShortcutPress,
	resolveDetectedOpenShortcutMode,
	runDetectedOpenCallback,
	runDetectedOpenCommand,
	runDetectedOpenControllerRequest,
	tryBeginDetectedOpenRequest,
} from '../../src/lib/detected-open-actions';

function createRequestId() {
	let current = 0;
	return {
		next: () => {
			current += 1;
			return current;
		},
		isCurrent: (requestId: number) => requestId === current,
		invalidate: () => {
			current += 1;
		},
	};
}

void test('detected open timeout is 30 seconds for auto mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('auto'), 30_000);
});

void test('detected open timeout is 60 seconds for pick mode', () => {
	assert.equal(getDetectedOpenTimeoutMs('pick'), 60_000);
});

void test('detected open shortcuts define the browser keyboard byte contract', () => {
	assert.deepEqual(DETECTED_OPEN_SHORTCUTS, [
		{
			mode: 'auto',
			keyboardId: 'browser_keyboard',
			bytes: [27, 97],
			actionId: 'OPEN_HOST_DETECTED_AUTO',
		},
		{
			mode: 'pick',
			keyboardId: 'browser_keyboard',
			bytes: [27, 65],
			actionId: 'OPEN_HOST_DETECTED_PICK',
		},
	]);
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

void test('detected open controller starts accepted request and clears in-flight state', async () => {
	const inFlightRef = { current: false };
	const openStates: boolean[] = [];
	const commands: { command: string; timeoutMs: number }[] = [];
	const errors: string[] = [];
	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId: createRequestId(),
		setOpen: (open) => {
			openStates.push(open);
		},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push({ command, timeoutMs });
			return '';
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	assert.deepEqual(openStates, [false]);
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, []);
	assert.deepEqual(commands, [
		{
			command:
				"TMUX_PANE='%9' TMUX_PANE_TTY='/dev/pts/9' TMUX_PANE_PATH='/tmp/project' mdev open auto",
			timeoutMs: 30_000,
		},
	]);
});

void test('detected open controller rejects busy request without closing modal', () => {
	const result = runDetectedOpenControllerRequest({
		mode: 'pick',
		inFlightRef: { current: true },
		requestId: createRequestId(),
		setOpen: () => {
			throw new Error('setOpen should not run');
		},
		showError: (title, message) => {
			assert.equal(title, 'Open already running');
			assert.equal(message, 'Wait for the current browser action to finish.');
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		resolvePaneContext: async () => {
			throw new Error('resolvePaneContext should not run');
		},
		runHostBrowserCommand: async () => {
			throw new Error('runHostBrowserCommand should not run');
		},
	});

	assert.deepEqual(result, { accepted: false, completion: null });
});

void test('detected open controller reports mode-specific failures and clears in-flight state', async () => {
	const cases = [
		{ mode: 'auto' as const, expected: 'Open failed: remote failed' },
		{ mode: 'pick' as const, expected: 'Pick failed: remote failed' },
	];

	for (const testCase of cases) {
		const inFlightRef = { current: false };
		const errors: string[] = [];
		const result = runDetectedOpenControllerRequest({
			mode: testCase.mode,
			inFlightRef,
			requestId: createRequestId(),
			setOpen: () => {},
			showError: (title, message) => {
				errors.push(`${title}: ${message}`);
			},
			getErrorMessage: (error) =>
				error instanceof Error ? error.message : String(error),
			resolvePaneContext: async () => ({
				paneId: '%9',
				paneTty: '/dev/pts/9',
				panePath: '/tmp/project',
			}),
			runHostBrowserCommand: async () => {
				throw new Error('remote failed');
			},
		});

		assert.equal(result.accepted, true);
		if (result.accepted) await result.completion;

		assert.equal(inFlightRef.current, false);
		assert.deepEqual(errors, [testCase.expected]);
	}
});

void test('detected open controller suppresses stale request side effects', async () => {
	const inFlightRef = { current: false };
	const requestId = createRequestId();
	const commands: string[] = [];
	const errors: string[] = [];
	let resumeContext: () => void = () => {
		throw new Error('resolvePaneContext was not started');
	};

	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId,
		setOpen: () => {},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		resolvePaneContext: async () =>
			new Promise((resolve) => {
				resumeContext = () => {
					resolve({
						paneId: '%9',
						paneTty: '/dev/pts/9',
						panePath: '/tmp/project',
					});
				};
			}),
		runHostBrowserCommand: async (command) => {
			commands.push(command);
			throw new Error('stale command should not run');
		},
	});

	assert.equal(result.accepted, true);
	assert.equal(inFlightRef.current, true);
	requestId.invalidate();
	inFlightRef.current = false;
	resumeContext();
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(commands, []);
	assert.deepEqual(errors, []);
});

void test('detected open controller suppresses stale command rejection', async () => {
	const inFlightRef = { current: false };
	const requestId = createRequestId();
	const commands: string[] = [];
	const errors: string[] = [];
	let rejectCommand: (error: Error) => void = () => {
		throw new Error('runHostBrowserCommand was not started');
	};

	const result = runDetectedOpenControllerRequest({
		mode: 'auto',
		inFlightRef,
		requestId,
		setOpen: () => {},
		showError: (title, message) => {
			errors.push(`${title}: ${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		resolvePaneContext: async () => ({
			paneId: '%9',
			paneTty: '/dev/pts/9',
			panePath: '/tmp/project',
		}),
		runHostBrowserCommand: async (command) =>
			new Promise((_, reject) => {
				commands.push(command);
				rejectCommand = reject;
			}),
	});

	assert.equal(result.accepted, true);
	await Promise.resolve();
	assert.equal(commands.length, 1);
	requestId.invalidate();
	inFlightRef.current = false;
	rejectCommand(new Error('stale remote failed'));
	if (result.accepted) await result.completion;

	assert.equal(inFlightRef.current, false);
	assert.deepEqual(errors, []);
});
