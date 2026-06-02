
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	accumulateWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createTmuxScrollbackLineAccumulator,
	formatWorkmuxScrollbackCommandFailureMessage,
	mergeWorkmuxScrollbackPageCommands,
	resetTmuxScrollbackRuntimeState,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
} from '../../src/lib/tmux-scrollback';
import { WORKMUX_APP_SCROLL_MAX_COUNT } from '../../src/lib/workmux-app-commands';

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
		[{ sessionName: 'main', direction: 'up', count: 2 }],
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
		[],
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
		[{ sessionName: 'main', direction: 'down', count: 1 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands accumulates rows-minus-one line batches into one receiver page', () => {
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
		[],
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
		[{ sessionName: 'main', direction: 'up', count: 1 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands nets line leftovers on direction change', () => {
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
		[],
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
		[],
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
		[],
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
		[{ sessionName: 'main', direction: 'down', count: 1 }],
	);
});

void test('accumulateWorkmuxScrollbackBatchCommands nets explicit pages and lines on reversal', () => {
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
		[],
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
		[],
	);
	assert.deepEqual(lineAccumulator, {
		direction: 'down',
		lines: 10,
	});
});

void test('clearTmuxScrollbackLineAccumulator drops line leftovers', () => {
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
		[],
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
		[],
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
			{ sessionName: 'main', direction: 'up', count: 20 },
			{ sessionName: 'main', direction: 'up', count: 5 },
		],
	);
});

void test('mergeWorkmuxScrollbackPageCommands coalesces adjacent page intents', () => {
	assert.deepEqual(
		mergeWorkmuxScrollbackPageCommands([
			{ sessionName: 'main', direction: 'up', count: 3 },
			{ sessionName: 'main', direction: 'up', count: 4 },
			{ sessionName: 'main', direction: 'down', count: 2 },
			{ sessionName: 'main', direction: 'down', count: 19 },
		]),
		[
			{ sessionName: 'main', direction: 'up', count: 7 },
			{ sessionName: 'main', direction: 'down', count: 20 },
			{ sessionName: 'main', direction: 'down', count: 1 },
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
		{ sessionName: 'main', direction: 'down', count: 20 },
		{ sessionName: 'main', direction: 'down', count: 20 },
		{ sessionName: 'main', direction: 'down', count: 20 },
		{ sessionName: 'main', direction: 'down', count: 20 },
		{ sessionName: 'main', direction: 'down', count: 20 },
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
		accumulateWorkmuxScrollbackBatchCommands({
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
		accumulateWorkmuxScrollbackBatchCommands({
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
