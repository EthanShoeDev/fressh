
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createTmuxScrollbackLineAccumulator,
	formatWorkmuxScrollbackCommandFailureMessage,
	resetTmuxScrollbackRuntimeState,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
} from '../../src/lib/tmux-scrollback';
import { WORKMUX_APP_SCROLL_MAX_COUNT } from '../../src/lib/workmux-app-commands';

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

void test('buildWorkmuxScrollbackBatchCommands nets line leftovers on direction change', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

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

void test('buildWorkmuxScrollbackBatchCommands nets explicit pages and lines on reversal', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
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
		buildWorkmuxScrollbackBatchCommands({
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
