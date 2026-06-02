import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShellLiveInputSendPlan } from '../../src/lib/shell-live-input';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));

void test('maps active multi-segment input to payload after app-owned scrollback exit', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70, 0x77, 0x64]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x70, 0x77, 0x64], [0x0d]]);
});

void test('implicitly detects exit-key payload when override is omitted', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), []);
});

void test('omitted override keeps a single non-exit payload', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x70])],
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x70]]);
});

void test('explicit false override preserves literal text equal to the exit key', () => {
	const plan = buildShellLiveInputSendPlan({
		scrollbackActive: true,
		exitKeyBytes: bytes([0x71]),
		payloadSegments: [bytes([0x71])],
		isCurrentPayloadExitKey: false,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.deepEqual(segmentValues(plan.segments), [[0x71]]);
});
