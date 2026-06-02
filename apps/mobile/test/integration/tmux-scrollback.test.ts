import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackLiveInputSendPlan,
	buildWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLineAccumulator,
	formatWorkmuxScrollbackCommandFailureMessage,
	handleWorkmuxScrollbackCommandFailureActions,
	isValidTmuxCancelKey,
	resetTmuxScrollbackRuntimeState,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
} from '../../src/lib/tmux-scrollback';
import { WORKMUX_APP_SCROLL_MAX_COUNT } from '../../src/lib/workmux-app-commands';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));
const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

void test('buildWorkmuxScrollbackBatchCommands builds page scroll commands', () => {
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 2,
			lines: 0,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		["mdev tmux app scroll page-up --count '2' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands accumulates sub-page lines by direction', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-down --count '1' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands accumulates rows-minus-one line batches into one receiver page', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const pageStep = 24;

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-up --count '1' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands resets line leftovers on direction change', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-up --count '1' --session 'main'"],
	);
});

void test('clearTmuxScrollbackLineAccumulator drops line leftovers', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
});

void test('buildWorkmuxScrollbackBatchCommands splits page commands above Workmux max count', () => {
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 25,
			lines: 0,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		[
			"mdev tmux app scroll page-up --count '20' --session 'main'",
			"mdev tmux app scroll page-up --count '5' --session 'main'",
		],
	);
});

void test('buildWorkmuxScrollbackBatchCommands clamps malformed huge batches before splitting', () => {
	const commands = buildWorkmuxScrollbackBatchCommands({
		sessionName: 'main',
		direction: 'down',
		pages: 1_000_000,
		lines: 0,
		linesPerPage: 24,
		lineAccumulator: createTmuxScrollbackLineAccumulator(),
	});

	assert.equal(
		commands.length,
		Math.ceil(
			TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH /
				WORKMUX_APP_SCROLL_MAX_COUNT,
		),
	);
	assert.deepEqual(commands, [
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
	]);
});

void test('formatWorkmuxScrollbackCommandFailureMessage formats missing mdev failures', () => {
	assert.equal(
		formatWorkmuxScrollbackCommandFailureMessage({
			success: false,
			output: '',
			error: 'mdev: command not found',
		}),
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	);
	assert.equal(
		formatWorkmuxScrollbackCommandFailureMessage({
			success: true,
			output: '',
		}),
		null,
	);
});

void test('resetTmuxScrollbackRuntimeState clears stale line leftovers', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	void resetTmuxScrollbackRuntimeState({ lineAccumulator });
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
});

void test('workmux scrollback executor serializes enter before scroll batches', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') {
				await firstBlock.promise;
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter');
	const batch = executor.enqueueScrollBatch(['page']);

	await Promise.resolve();
	assert.deepEqual(commands, ['enter']);
	firstBlock.resolve(undefined);
	assert.equal(await enter, true);
	await batch;
	assert.deepEqual(commands, ['enter', 'page']);
});

void test('workmux scrollback executor suppresses enter ack and clears pending scroll after failure', async () => {
	const failures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: '',
			error: 'mdev: command not found',
		}),
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter');
	const batch = executor.enqueueScrollBatch(['page']);

	assert.equal(await enter, false);
	assert.equal(await batch, false);
	assert.deepEqual(failures, [
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	]);
});

void test('workmux scrollback executor formats thrown failures and stops a batch', async () => {
	const commands: string[] = [];
	const failures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'first') throw new Error('Command timed out');
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	assert.equal(await executor.enqueueScrollBatch(['first', 'second']), false);
	assert.deepEqual(commands, ['first']);
	assert.deepEqual(failures, ['Command timed out']);
});

void test('workmux scrollback executor invokes failure cleanup hooks', async () => {
	const events: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: 'permission denied',
			error: 'permission denied',
		}),
		onFailure: (message) => {
			events.push(`failure:${message}`);
			events.push('cancel');
			events.push('clear');
		},
	});

	assert.equal(await executor.runEnterCommand('enter'), false);
	assert.deepEqual(events, ['failure:permission denied', 'cancel', 'clear']);
});

void test('workmux scrollback executor coalesces pending scroll batches while slow command runs', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'first') await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const first = executor.enqueueScrollBatch(['first']);
	await Promise.resolve();
	assert.deepEqual(commands, ['first']);

	const stale = executor.enqueueScrollBatch(['stale']);
	const latest = executor.enqueueScrollBatch(['latest']);
	assert.equal(executor.getPendingScrollBatchCount(), 1);
	firstBlock.resolve(undefined);

	assert.equal(await first, true);
	assert.equal(await stale, false);
	assert.equal(await latest, true);
	assert.deepEqual(commands, ['first', 'latest']);
});

void test('workmux scrollback executor dispose clears pending scroll and blocks queued execution', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter');
	await Promise.resolve();
	const batch = executor.enqueueScrollBatch(['page']);
	executor.dispose();

	assert.equal(await batch, false);
	firstBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter']);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, ['enter']);
});

void test('workmux scrollback executor dispose suppresses late failure callbacks', async () => {
	const commandBlock = deferred<void>();
	const failures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => {
			await commandBlock.promise;
			return { success: false, output: '', error: 'mdev: command not found' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter');
	await Promise.resolve();
	executor.dispose();
	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.deepEqual(failures, []);
});

void test('resetTmuxScrollbackRuntimeState cancels in-flight enter and unwinds remote copy mode', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const failures: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter', {
		cancelCommand: 'exit',
	});
	await Promise.resolve();
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.deepEqual(failures, []);
});

void test('resetTmuxScrollbackRuntimeState cancels queued enter before it starts', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'blocking-scroll') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const blocking = executor.enqueueScrollBatch(['blocking-scroll']);
	await Promise.resolve();
	const enter = executor.runEnterCommand('enter', {
		cancelCommand: 'exit',
	});
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await blocking, false);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['blocking-scroll']);
});

void test('resetTmuxScrollbackRuntimeState cancels pending Workmux scroll batches', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter');
	await Promise.resolve();
	const batch = executor.enqueueScrollBatch(['page']);

	assert.equal(executor.getPendingScrollBatchCount(), 1);
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	assert.equal(executor.getPendingScrollBatchCount(), 0);
	assert.equal(await batch, false);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter']);
});

void test('resetTmuxScrollbackRuntimeState requests Workmux scroll exit for acknowledged remote copy mode', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'slow-page') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const page = executor.enqueueScrollBatch(['slow-page']);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await page, false);
	assert.equal(await exit, true);
	assert.deepEqual(commands, ['slow-page', 'exit']);
});

void test('resetTmuxScrollbackRuntimeState skips Workmux scroll exit before remote copy mode ack', () => {
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});

	assert.equal(exit, null);
	assert.deepEqual(commands, []);
});

void test('workmux scrollback failure actions alert and clear without cancel before remote ack', () => {
	const events: string[] = [];

	handleWorkmuxScrollbackCommandFailureActions({
		message: 'Update mdev',
		commandKind: 'enter',
		scrollbackActive: true,
		remoteCopyModeActive: false,
		cancelKeyBytes: bytes([0x71]),
		alert: (title, message, buttons) => {
			events.push(`alert:${title}:${message}:${buttons?.length ?? 0}`);
			buttons?.[0]?.onPress?.();
		},
		copyMessage: (message) => events.push(`copy:${message}`),
		sendCancelKey: () => events.push('cancel'),
		clearScrollbackState: () => events.push('clear'),
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, [
		'warn:Update mdev',
		'alert:Workmux scroll unavailable:Update mdev:2',
		'copy:Update mdev',
		'clear',
	]);
});

void test('workmux scrollback failure actions cancel only after remote copy mode is acknowledged', () => {
	const events: string[] = [];

	handleWorkmuxScrollbackCommandFailureActions({
		message: 'page failed',
		commandKind: 'scroll',
		scrollbackActive: true,
		remoteCopyModeActive: true,
		cancelKeyBytes: bytes([0x71]),
		alert: (title, message) => events.push(`alert:${title}:${message}`),
		copyMessage: (message) => events.push(`copy:${message}`),
		sendCancelKey: (cancelKey) =>
			events.push(`cancel:${Array.from(cancelKey).join(',')}`),
		clearScrollbackState: () => events.push('clear'),
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, [
		'warn:page failed',
		'alert:Workmux scroll unavailable:page failed',
		'cancel:113',
		'clear',
	]);
});

void test('workmux scrollback failure actions warn instead of sending invalid cancel key', () => {
	const events: string[] = [];

	handleWorkmuxScrollbackCommandFailureActions({
		message: 'page failed',
		commandKind: 'scroll',
		scrollbackActive: true,
		remoteCopyModeActive: true,
		cancelKeyBytes: bytes([0x1b]),
		alert: (title, message) => events.push(`alert:${title}:${message}`),
		copyMessage: (message) => events.push(`copy:${message}`),
		sendCancelKey: () => events.push('cancel'),
		clearScrollbackState: () => events.push('clear'),
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, [
		'warn:page failed',
		'alert:Workmux scroll unavailable:page failed',
		'warn:cancelKey invalid; cannot exit scrollback after Workmux scroll failure',
		'clear',
	]);
});

void test('tmux cancel key validation accepts single non-escape keys only', () => {
	assert.equal(isValidTmuxCancelKey(bytes([0x71])), true);
	assert.equal(isValidTmuxCancelKey(bytes([0x1b])), false);
	assert.equal(isValidTmuxCancelKey(bytes([])), false);
	assert.equal(isValidTmuxCancelKey(bytes([0x71, 0x0d])), false);
});

void test('live input plan passes payload through when scrollback is inactive', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'send',
		segments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		clearScrollback: false,
	});
});

void test('live input plan ignores invalid cancel key when scrollback is inactive', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		cancelKey: bytes([0x1b]),
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'send',
		segments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		clearScrollback: false,
	});
});

void test('live input plan drops empty payload segments while inactive', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([]), bytes([0x68]), bytes([]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'send',
		segments: [bytes([0x68]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		clearScrollback: false,
	});
});

void test('live input plan exits active scrollback before payload', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 0,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x71], [0x61, 0x62]]);
});

void test('live input plan preserves multi-segment payload order after scrollback exit', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x68, 0x69]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [
		[0x71],
		[0x68, 0x69],
		[0x0d],
	]);
});

void test('live input plan drops empty payload segments while preserving order', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([]), bytes([0x68]), bytes([]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.deepEqual(segmentValues(plan.segments), [
		[0x71],
		[0x68],
		[0x69, 0x21],
	]);
});

void test('live input plan blocks active scrollback when cancel key is invalid', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x1b]),
		payloadSegments: [bytes([0x61])],
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		type: 'block',
		reason: 'invalid-cancel-key',
	});
});

void test('live input plan can treat the payload as only a scrollback exit key', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		cancelKey: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		dropPayloadAfterExit: true,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x71]]);
});
