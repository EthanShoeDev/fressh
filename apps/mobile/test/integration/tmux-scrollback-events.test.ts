import assert from 'node:assert/strict';
import test from 'node:test';
import { handleTmuxScrollbackBatchEvent } from '../../src/lib/tmux-scrollback';
import { type WorkmuxControlChannel } from '../../src/lib/workmux-control-channel';
import {
	createTmuxScrollbackLineAccumulator,
	type WorkmuxScrollbackPageCommand,
} from '../../src/lib/workmux-scrollback-batch';
import { createWorkmuxScrollbackCommandExecutor } from '../../src/lib/workmux-scrollback-executor';

const noopScrollTransport: WorkmuxControlChannel['scroll'] = {
	enter: async () => ({ success: true, output: '' }),
	move: async () => ({ success: true, output: '' }),
	exit: async () => ({ success: true, output: '' }),
};

void test('scrollback batch adapter gates events and passes pageStep into command building', async () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const commands: WorkmuxScrollbackPageCommand[][] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		scrollTransport: noopScrollTransport,
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
			remoteCopyModeActive: true,
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
		{ remoteCopyModeActive: false },
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
				event: event as Parameters<
					typeof handleTmuxScrollbackBatchEvent
				>[0]['event'],
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
		true,
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
		[
			{ sessionName: 'main', direction: 'up', unit: 'line', count: 20 },
			{ sessionName: 'main', direction: 'up', unit: 'line', count: 3 },
		],
		[{ sessionName: 'main', direction: 'up', unit: 'line', count: 1 }],
		[{ sessionName: 'main', direction: 'up', unit: 'page', count: 1 }],
	]);
});
