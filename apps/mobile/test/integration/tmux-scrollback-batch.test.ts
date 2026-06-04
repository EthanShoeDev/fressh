import assert from 'node:assert/strict';
import test from 'node:test';
import { resetTmuxScrollbackRuntimeState } from '../../src/lib/tmux-scrollback';
import { WORKMUX_APP_SCROLL_MAX_COUNT } from '../../src/lib/workmux-app-commands';
import {
	accumulateWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createTmuxScrollbackLineAccumulator,
	mergeWorkmuxScrollbackPageCommands,
	TMUX_SCROLLBACK_RECEIVER_MAX_LINES_PER_BATCH,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
} from '../../src/lib/workmux-scrollback-batch';
import { formatWorkmuxScrollbackCommandFailureMessage } from '../../src/lib/workmux-scrollback-executor';

void test('accumulateWorkmuxScrollbackBatchCommands builds page scroll commands', () => {
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 2,
			lines: 0,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		[{ sessionName: 'main', direction: 'up', unit: 'page', count: 2 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands accumulates sub-page lines by direction', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands preserves page and line scroll intents', () => {
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 2,
			lines: 7,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		[
			{ sessionName: 'main', direction: 'up', unit: 'page', count: 2 },
			{ sessionName: 'main', direction: 'up', unit: 'line', count: 7 },
		],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands emits sub-page lines immediately', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const pageStep = 24;

	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'up', unit: 'line', count: 12 }],
	);
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'up', unit: 'line', count: 12 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands preserves line direction changes', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'up', unit: 'line', count: 12 }],
	);
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
	assert.deepEqual(lineAccumulator, { direction: null, lines: 0 });
});

void test('accumulateWorkmuxScrollbackBatchCommands keeps page and line units separate on reversal', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 20,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 }],
	);
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 1,
			lines: 6,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[
			{ sessionName: 'main', direction: 'down', unit: 'page', count: 1 },
			{ sessionName: 'main', direction: 'down', unit: 'line', count: 6 },
		],
	);
	assert.deepEqual(lineAccumulator, {
		direction: null,
		lines: 0,
	});
});

void test('clearTmuxScrollbackLineAccumulator is harmless after direct line commands', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands splits page commands above Workmux max count', () => {
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 25,
			lines: 0,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		[
			{ sessionName: 'main', direction: 'up', unit: 'page', count: 20 },
			{ sessionName: 'main', direction: 'up', unit: 'page', count: 5 },
		],
	);
});

void test('mergeWorkmuxScrollbackPageCommands coalesces adjacent page intents', () => {
	assert.deepEqual(
		mergeWorkmuxScrollbackPageCommands([
			{ sessionName: 'main', direction: 'up', unit: 'page', count: 3 },
			{ sessionName: 'main', direction: 'up', unit: 'page', count: 4 },
			{ sessionName: 'main', direction: 'down', unit: 'page', count: 2 },
			{ sessionName: 'main', direction: 'down', unit: 'page', count: 19 },
		]),
		[
			{ sessionName: 'main', direction: 'up', unit: 'page', count: 7 },
			{ sessionName: 'main', direction: 'down', unit: 'page', count: 20 },
			{ sessionName: 'main', direction: 'down', unit: 'page', count: 1 },
		],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands clamps malformed huge batches before splitting', () => {
	const commands = accumulateWorkmuxScrollbackBatchCommands({
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
		{ sessionName: 'main', direction: 'down', unit: 'page', count: 20 },
		{ sessionName: 'main', direction: 'down', unit: 'page', count: 20 },
		{ sessionName: 'main', direction: 'down', unit: 'page', count: 20 },
		{ sessionName: 'main', direction: 'down', unit: 'page', count: 20 },
		{ sessionName: 'main', direction: 'down', unit: 'page', count: 20 },
	]);
});

void test('accumulateWorkmuxScrollbackBatchCommands clamps malformed huge line batches before splitting', () => {
	const commands = accumulateWorkmuxScrollbackBatchCommands({
		sessionName: 'main',
		direction: 'up',
		pages: 0,
		lines: 1_000_000,
		linesPerPage: 24,
		lineAccumulator: createTmuxScrollbackLineAccumulator(),
	});

	assert.equal(
		commands.length,
		Math.ceil(
			TMUX_SCROLLBACK_RECEIVER_MAX_LINES_PER_BATCH /
				WORKMUX_APP_SCROLL_MAX_COUNT,
		),
	);
	assert.deepEqual(commands, [
		{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 },
		{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 },
		{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 },
		{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 },
		{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 },
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

void test('formatWorkmuxScrollbackCommandFailureMessage preserves local no-connection failures', () => {
	assert.equal(
		formatWorkmuxScrollbackCommandFailureMessage({
			success: false,
			output: '',
			error: 'No SSH connection available for main.',
		}),
		'No SSH connection available for main.',
	);
});

void test('resetTmuxScrollbackRuntimeState leaves direct line commands usable', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
	void resetTmuxScrollbackRuntimeState({ lineAccumulator });
	assert.deepEqual(
		accumulateWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[{ sessionName: 'main', direction: 'down', unit: 'line', count: 12 }],
	);
});
