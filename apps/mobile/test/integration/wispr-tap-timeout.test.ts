import assert from 'node:assert/strict';
import test from 'node:test';

import {
	tapWisprControlWithTimeout,
	WisprTapTimeoutError,
	withTimeout,
} from '../../src/lib/wispr-tap-timeout';

const nextTick = () =>
	new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

void test('Wispr tap timeout reports late native success', async () => {
	let resolveTap: (value: string) => void = () => {};
	let lateSuccessCount = 0;
	const tapPromise = new Promise<string>((resolve) => {
		resolveTap = resolve;
	});

	await assert.rejects(
		tapWisprControlWithTimeout({
			tapWisprControl: () => tapPromise,
			timeoutMs: 1,
			onLateSuccess: () => {
				lateSuccessCount += 1;
			},
		}),
		WisprTapTimeoutError,
	);

	resolveTap('ok');
	await nextTick();

	assert.equal(lateSuccessCount, 1);
});

void test('Wispr tap timeout reports late native failure', async () => {
	let rejectTap: (error: Error) => void = () => {};
	let lateFailureCount = 0;
	const tapPromise = new Promise<string>((_, reject) => {
		rejectTap = reject;
	});

	await assert.rejects(
		tapWisprControlWithTimeout({
			tapWisprControl: () => tapPromise,
			timeoutMs: 1,
			onLateFailure: () => {
				lateFailureCount += 1;
			},
		}),
		WisprTapTimeoutError,
	);

	rejectTap(new Error('native tap failed'));
	await nextTick();

	assert.equal(lateFailureCount, 1);
});

void test('withTimeout resolves before the deadline', async () => {
	assert.equal(await withTimeout(Promise.resolve('ok'), 10), 'ok');
});

void test('withTimeout rejects when the wrapped promise hangs', async () => {
	await assert.rejects(
		withTimeout(new Promise<string>(() => {}), 1),
		WisprTapTimeoutError,
	);
});
