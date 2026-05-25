import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackCopyModeCommand,
	buildTmuxScrollbackLiveInputSendPlan,
	buildTmuxSelectWindowCommand,
	getTmuxScrollbackControlFailurePolicy,
	isValidTmuxCancelKey,
} from '../../src/lib/tmux-scrollback';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));

void test('buildTmuxScrollbackCopyModeCommand enters copy mode through tmux control shell', () => {
	assert.equal(
		buildTmuxScrollbackCopyModeCommand("main's"),
		"tmux copy-mode -t 'main'\\''s'",
	);
});

void test('buildTmuxSelectWindowCommand targets an agent alert tmux window id', () => {
	assert.equal(
		buildTmuxSelectWindowCommand("main's", '@12'),
		"tmux select-window -t 'main'\\''s:@12'",
	);
});

void test('tmux scrollback control failure policy only exits active scrollback', () => {
	assert.equal(
		getTmuxScrollbackControlFailurePolicy({ scrollbackActive: false }),
		'restart-control-only',
	);
	assert.equal(
		getTmuxScrollbackControlFailurePolicy({ scrollbackActive: true }),
		'exit-scrollback-and-restart-control',
	);
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
		payloadSegments: [
			bytes([]),
			bytes([0x68]),
			bytes([]),
			bytes([0x69, 0x21]),
		],
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
		payloadSegments: [
			bytes([]),
			bytes([0x68]),
			bytes([]),
			bytes([0x69, 0x21]),
		],
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
