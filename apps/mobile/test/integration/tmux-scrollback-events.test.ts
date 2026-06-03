import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTmuxScrollbackLineAccumulator,
	createWorkmuxScrollbackCommandExecutor,
	handleTmuxScrollbackBatchEvent,
	type WorkmuxScrollbackPageCommand,
} from '../../src/lib/tmux-scrollback';

void test('scrollback batch adapter gates events and passes pageStep into command building', async () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const commands: WorkmuxScrollbackPageCommand[][] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({ success: true, output: '' }),
		onFailure: () => {},
	});
	const enqueueScrollBatch = executor.enqueueScrollBatch.bind(executor);
	const baseEvent = {
		direction: 'up' as const,
		pages: 1,
		lines: 0,
		pageStep: 24,
		instanceId: 'current',
	};
	const runBatch = (
		overrides: Partial<Parameters<typeof handleTmuxScrollbackBatchEvent>[0]>,
	) =>
		handleTmuxScrollbackBatchEvent({
			event: baseEvent,
			shellAvailable: true,
			currentInstanceId: 'current',
			selectionModeEnabled: false,
			tmuxEnabled: true,
			connectionAvailable: true,
			scrollbackActive: true,
			targetName: 'main',
			lineAccumulator,
			enqueueScrollBatch: (batch) => {
				commands.push(batch);
				return enqueueScrollBatch(batch);
			},
			...overrides,
		});

	const rejectedCases: Partial<
		Parameters<typeof handleTmuxScrollbackBatchEvent>[0]
	>[] = [
		{ shellAvailable: false },
		{ currentInstanceId: 'other' },
		{ selectionModeEnabled: true },
		{ tmuxEnabled: false },
		{ connectionAvailable: false },
		{ scrollbackActive: false },
	];
	for (const rejected of rejectedCases) {
		assert.equal(runBatch(rejected), false);
	}
	assert.deepEqual(commands, []);

	for (const event of [
		{ ...baseEvent, direction: 'sideways' },
		{ ...baseEvent, pages: -1 },
		{ ...baseEvent, pages: Number.NaN },
		{ ...baseEvent, lines: -1 },
		{ ...baseEvent, lines: Number.POSITIVE_INFINITY },
		{ ...baseEvent, pageStep: 0 },
		{ ...baseEvent, pageStep: Number.NaN },
	]) {
		lineAccumulator.direction = 'up';
		lineAccumulator.lines = 12;
		assert.equal(
			runBatch({
				event: event as Parameters<typeof handleTmuxScrollbackBatchEvent>[0]['event'],
			}),
			false,
		);
		assert.deepEqual(lineAccumulator, { direction: 'up', lines: 12 });
	}
	assert.deepEqual(commands, []);
	lineAccumulator.direction = null;
	lineAccumulator.lines = 0;

	assert.equal(
		runBatch({
			event: {
				direction: 'up',
				pages: 0,
				lines: 23,
				pageStep: 24,
				instanceId: 'current',
			},
		}),
		false,
	);
	assert.equal(
		runBatch({
			event: {
				direction: 'up',
				pages: 0,
				lines: 1,
				pageStep: 24,
				instanceId: 'current',
			},
		}),
		true,
	);
	assert.equal(runBatch({}), true);

	assert.deepEqual(commands, [
		[{ sessionName: 'main', direction: 'up', count: 1 }],
		[{ sessionName: 'main', direction: 'up', count: 1 }],
	]);
});
