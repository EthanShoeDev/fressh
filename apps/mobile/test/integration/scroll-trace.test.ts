import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
	SCROLL_TRACE_LOG_PREFIX,
	buildScrollTraceLine,
	emitScrollTrace,
	isScrollTraceSummaryHealthy,
	isScrollTraceEnabled,
	parseScrollTraceLogLine,
	summarizeScrollTraceEvents,
	type ScrollTraceEvent,
} from '../../src/lib/scroll-trace';

void test('scroll trace log lines round-trip as prefixed JSON', () => {
	const line = buildScrollTraceLine(
		{
			event: 'rn.batch.accepted',
			traceId: 'trace-1',
			targetName: 'main',
			seq: 7,
			lines: 5,
			direction: 'down',
		},
		() => 1234,
	);

	assert.equal(
		line,
		`${SCROLL_TRACE_LOG_PREFIX} {"at":1234,"event":"rn.batch.accepted","traceId":"trace-1","targetName":"main","seq":7,"lines":5,"direction":"down"}`,
	);
	assert.deepEqual(parseScrollTraceLogLine(`ReactNativeJS: ${line}`), {
		at: 1234,
		event: 'rn.batch.accepted',
		traceId: 'trace-1',
		targetName: 'main',
		seq: 7,
		lines: 5,
		direction: 'down',
	});
	assert.equal(parseScrollTraceLogLine('ReactNativeJS: other line'), null);
});

void test('scroll trace emission is disabled unless explicitly enabled', () => {
	const previous = process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE;
	const originalLog = console.log;
	const logs: unknown[][] = [];
	console.log = (...args: unknown[]) => {
		logs.push(args);
	};

	try {
		delete process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE;
		assert.equal(isScrollTraceEnabled(), false);
		emitScrollTrace({ event: 'rn.batch.accepted' }, () => 1234);
		assert.deepEqual(logs, []);

		process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE = 'true';
		assert.equal(isScrollTraceEnabled(), true);
		emitScrollTrace({ event: 'rn.batch.accepted' }, () => 1234);
		assert.deepEqual(logs, [
			[`${SCROLL_TRACE_LOG_PREFIX} {"at":1234,"event":"rn.batch.accepted"}`],
		]);
	} finally {
		console.log = originalLog;
		if (previous === undefined) {
			delete process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE;
		} else {
			process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE = previous;
		}
	}
});

void test('scroll trace summary measures gesture and command latency', () => {
	const events: ScrollTraceEvent[] = [
		{ at: 1000, event: 'rn.mode', active: true, phase: 'dragging' },
		{ at: 1010, event: 'rn.batch.accepted', lines: 1 },
		{ at: 1040, event: 'executor.command.start', commandKind: 'enter' },
		{ at: 1090, event: 'executor.command.end', commandKind: 'enter' },
		{ at: 1120, event: 'executor.command.start', commandKind: 'scroll' },
		{
			at: 1185,
			event: 'executor.command.end',
			commandKind: 'scroll',
			success: false,
			error: 'not in a mode',
		},
		{ at: 1190, event: 'rn.remote.inactive', reason: 'not-in-mode' },
	];

	assert.deepEqual(summarizeScrollTraceEvents(events), {
		eventCount: 7,
		firstAt: 1000,
		lastAt: 1190,
		durationMs: 190,
		batchCount: 1,
		acceptedBatchCount: 1,
		droppedBatchCount: 0,
		dropReasons: {},
		commandCount: 2,
		failedCommandCount: 1,
		firstFailureAt: 1185,
		firstFailureAfterStartMs: 185,
		notInModeCount: 2,
		maxQueueDepth: 0,
		maxPendingResolvers: 0,
		commandDurationMs: {
			count: 2,
			avg: 57.5,
			max: 65,
		},
	});
});

void test('scroll trace summary counts all not-in-mode error shapes', () => {
	const events: ScrollTraceEvent[] = [
		{ at: 1000, event: 'rn.remote.inactive', reason: 'not-in-mode' },
		{
			at: 1010,
			event: 'executor.command.end',
			success: false,
			error: 'Tmux scroll unavailable: not in the mode.',
		},
		{
			at: 1020,
			event: 'executor.command.end',
			success: false,
			message: 'tmux reports not in a mode',
		},
	];

	assert.equal(summarizeScrollTraceEvents(events).notInModeCount, 3);
});

void test('scroll trace health helper enforces acceptance and error thresholds', () => {
	const healthySummary = summarizeScrollTraceEvents([
		{ at: 1000, event: 'rn.batch.accepted' },
		{
			at: 1010,
			event: 'executor.command.end',
			success: true,
			durationMs: 12,
		},
	]);

	assert.equal(
		isScrollTraceSummaryHealthy(healthySummary, {
			minAcceptedBatches: 1,
			maxAverageCommandDurationMs: 20,
		}),
		true,
	);
	assert.equal(
		isScrollTraceSummaryHealthy(healthySummary, {
			minAcceptedBatches: 2,
		}),
		false,
	);
	assert.equal(
		isScrollTraceSummaryHealthy(healthySummary, {
			maxAverageCommandDurationMs: 10,
		}),
		false,
	);
	assert.equal(
		isScrollTraceSummaryHealthy(
			{
				eventCount: 10,
				acceptedBatchCount: 3,
				droppedBatchCount: 0,
				failedCommandCount: 0,
				notInModeCount: 0,
				commandDurationMs: { avg: 12 },
			},
			{ minAcceptedBatches: 1, maxAverageCommandDurationMs: 50 },
		),
		true,
	);
	assert.equal(
		isScrollTraceSummaryHealthy(
			{
				eventCount: 10,
				acceptedBatchCount: 3,
				droppedBatchCount: 0,
				failedCommandCount: 0,
				notInModeCount: 0,
			},
			{ minAcceptedBatches: 1, maxAverageCommandDurationMs: 50 },
		),
		false,
	);

	const unhealthySummary = summarizeScrollTraceEvents([
		{ at: 1000, event: 'rn.batch.accepted' },
		{ at: 1010, event: 'rn.batch.dropped', reason: 'remote-inactive' },
		{
			at: 1020,
			event: 'executor.command.end',
			success: false,
			error: 'not in a mode',
		},
	]);

	assert.equal(isScrollTraceSummaryHealthy(unhealthySummary), false);
	assert.equal(
		isScrollTraceSummaryHealthy({
			...healthySummary,
			eventCount: 0,
		}),
		false,
	);
});

void test('scroll trace summary groups dropped batch reasons', () => {
	const events: ScrollTraceEvent[] = [
		{ at: 1000, event: 'rn.mode', active: true },
		{ at: 1010, event: 'rn.batch.dropped', reason: 'empty' },
		{ at: 1020, event: 'rn.batch.dropped', reason: 'empty' },
		{ at: 1030, event: 'rn.batch.dropped', reason: 'remote-inactive' },
		{ at: 1040, event: 'rn.batch.accepted' },
	];

	assert.deepEqual(summarizeScrollTraceEvents(events).dropReasons, {
		empty: 2,
		'remote-inactive': 1,
	});
});

void test('scroll trace collector rejects invalid numeric thresholds before adb', () => {
	const invalidThreshold = spawnSync(
		process.execPath,
		[
			'scripts/collect-scroll-trace.mjs',
			'--max-average-command-duration-ms',
			'nope',
		],
		{ encoding: 'utf8' },
	);
	assert.notEqual(invalidThreshold.status, 0);
	assert.match(
		invalidThreshold.stderr,
		/--max-average-command-duration-ms must be a finite number/,
	);

	const invalidMinBatches = spawnSync(
		process.execPath,
		['scripts/collect-scroll-trace.mjs', '--min-accepted-batches', '1.5'],
		{ encoding: 'utf8' },
	);
	assert.notEqual(invalidMinBatches.status, 0);
	assert.match(
		invalidMinBatches.stderr,
		/--min-accepted-batches must be a non-negative integer/,
	);
});
