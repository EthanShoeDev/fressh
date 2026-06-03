import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildWorkmuxScrollbackLiveInputSendPlan,
	runWorkmuxScrollbackLiveInputSendPlan,
} from '../../src/lib/tmux-scrollback';

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

void test('live input plan passes payload through when scrollback is inactive', () => {
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		segments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		clearScrollback: false,
	});
});

void test('live input plan drops empty payload segments while inactive', () => {
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		payloadSegments: [bytes([]), bytes([0x68]), bytes([]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		segments: [bytes([0x68]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		clearScrollback: false,
	});
});

void test('live input plan exits active scrollback without primary-shell cancel before payload', () => {
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 0,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x61, 0x62]]);
});

void test('live input plan drops the scrollback exit-key payload after cleanup', () => {
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x71])],
		scrollbackExitKeyPayload: bytes([0x71]),
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(segmentValues(plan.segments), []);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
});

void test('live input runner starts cleanup for exit-key-only payload without sending bytes', async () => {
	const cleanup = Promise.resolve(true);
	let cleanupStarted = 0;
	const sentSegments: number[][][] = [];
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x71])],
		scrollbackExitKeyPayload: bytes([0x71]),
		scrollbackExitDelayMs: 10,
	});

	const result = runWorkmuxScrollbackLiveInputSendPlan({
		plan,
		currentCleanup: null,
		startCleanup: () => {
			cleanupStarted += 1;
			return cleanup;
		},
		remoteCopyModeActive: true,
		sendSegments: (segments) => {
			sentSegments.push(segmentValues(segments));
		},
	});

	assert.equal(result, cleanup);
	assert.equal(cleanupStarted, 1);
	await cleanup;
	await Promise.resolve();
	assert.deepEqual(sentSegments, []);
});

void test('live input runner sends non-empty payload after successful cleanup', async () => {
	const cleanup = deferred<boolean>();
	const sentSegments: number[][][] = [];
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x68, 0x69])],
		scrollbackExitDelayMs: 10,
	});

	const result = runWorkmuxScrollbackLiveInputSendPlan({
		plan,
		currentCleanup: cleanup.promise,
		startCleanup: () => {
			throw new Error('should use current cleanup');
		},
		remoteCopyModeActive: true,
		sendSegments: (segments) => {
			sentSegments.push(segmentValues(segments));
		},
	});

	assert.equal(result, cleanup.promise);
	assert.deepEqual(sentSegments, []);
	cleanup.resolve(true);
	await cleanup.promise;
	await Promise.resolve();
	assert.deepEqual(sentSegments, [[[0x68, 0x69]]]);
});

void test('live input runner suppresses deferred payload after request invalidation', async () => {
	const cleanup = deferred<boolean>();
	const sentSegments: number[][][] = [];
	let requestCurrent = true;
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x68, 0x69])],
		scrollbackExitDelayMs: 10,
	});

	const result = runWorkmuxScrollbackLiveInputSendPlan({
		plan,
		currentCleanup: cleanup.promise,
		startCleanup: () => {
			throw new Error('should use current cleanup');
		},
		remoteCopyModeActive: true,
		isRequestCurrent: () => requestCurrent,
		sendSegments: (segments) => {
			sentSegments.push(segmentValues(segments));
		},
	});

	assert.equal(result, cleanup.promise);
	requestCurrent = false;
	cleanup.resolve(true);
	await cleanup.promise;
	await Promise.resolve();
	assert.deepEqual(sentSegments, []);
});

void test('live input runner blocks non-empty payload after failed cleanup', async () => {
	const cleanup = Promise.resolve(false);
	const sentSegments: number[][][] = [];
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x68, 0x69])],
		scrollbackExitDelayMs: 10,
	});

	const result = runWorkmuxScrollbackLiveInputSendPlan({
		plan,
		currentCleanup: cleanup,
		startCleanup: () => null,
		remoteCopyModeActive: true,
		sendSegments: (segments) => {
			sentSegments.push(segmentValues(segments));
		},
	});

	assert.equal(result, cleanup);
	await cleanup;
	await Promise.resolve();
	assert.deepEqual(sentSegments, []);
});

void test('live input runner blocks non-empty payload while remote copy mode is active without cleanup', () => {
	const sentSegments: number[][][] = [];
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		payloadSegments: [bytes([0x68, 0x69])],
		scrollbackExitDelayMs: 10,
	});

	const result = runWorkmuxScrollbackLiveInputSendPlan({
		plan,
		currentCleanup: null,
		startCleanup: () => null,
		remoteCopyModeActive: true,
		sendSegments: (segments) => {
			sentSegments.push(segmentValues(segments));
		},
	});

	assert.equal(result, null);
	assert.deepEqual(sentSegments, []);
});

void test('live input plan preserves multi-segment payload order after app-owned scrollback exit', () => {
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x68, 0x69]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x68, 0x69], [0x0d]]);
});

void test('live input plan drops empty payload segments while preserving order', () => {
	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([]), bytes([0x68]), bytes([]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(segmentValues(plan.segments), [[0x68], [0x69, 0x21]]);
});
