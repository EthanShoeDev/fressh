import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackLiveInputSendPlan,
	buildWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createWorkmuxScrollbackCommandQueue,
	createTmuxScrollbackLineAccumulator,
	formatWorkmuxScrollbackCommandFailureMessage,
	isValidTmuxCancelKey,
	resolveTmuxScrollbackReceiverLinesPerPage,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
} from '../../src/lib/tmux-scrollback';
import { WORKMUX_APP_SCROLL_MAX_COUNT } from '../../src/lib/workmux-app-commands';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));

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
	const linesPerPage = resolveTmuxScrollbackReceiverLinesPerPage(25);

	assert.equal(linesPerPage, 24);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage,
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
			linesPerPage,
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

void test('resolveTmuxScrollbackReceiverLinesPerPage matches the WebView producer floor', () => {
	assert.equal(resolveTmuxScrollbackReceiverLinesPerPage(5), 10);
	assert.equal(resolveTmuxScrollbackReceiverLinesPerPage(undefined), 23);
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

void test('workmux scrollback command queue serializes concurrent operations', async () => {
	const queue = createWorkmuxScrollbackCommandQueue();
	const events: string[] = [];
	let releaseFirst: () => void = () => {};
	const firstBlock = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});

	const first = queue.enqueue(async () => {
		events.push('first-start');
		await firstBlock;
		events.push('first-end');
		return 'first';
	});
	const second = queue.enqueue(async () => {
		events.push('second-start');
		return 'second';
	});

	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(events, ['first-start']);

	releaseFirst();
	assert.equal(await first, 'first');
	assert.equal(await second, 'second');
	assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
});

void test('workmux scrollback command queue continues after failed operation', async () => {
	const queue = createWorkmuxScrollbackCommandQueue();
	const events: string[] = [];

	await assert.rejects(
		queue.enqueue(async () => {
			events.push('first');
			throw new Error('failed');
		}),
		/failed/,
	);
	assert.equal(
		await queue.enqueue(async () => {
			events.push('second');
			return 'ok';
		}),
		'ok',
	);
	assert.deepEqual(events, ['first', 'second']);
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
