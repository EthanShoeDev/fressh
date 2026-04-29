import assert from 'node:assert/strict';
import test from 'node:test';
import {
	reduceWisprAutomationState,
	type WisprAutomationState,
} from '../../src/lib/wispr-automation-state';

void test('first press opens and focuses text entry before starting Wispr', () => {
	const initial: WisprAutomationState = { phase: 'idle' };

	const opening = reduceWisprAutomationState(initial, { type: 'press' });
	assert.deepEqual(opening, { phase: 'openingTextEntry' });

	const waiting = reduceWisprAutomationState(opening, {
		type: 'textEntryFocused',
		textBeforeStart: '',
	});
	assert.deepEqual(waiting, {
		phase: 'waitingForBubble',
		textBeforeStart: '',
	});

	const recording = reduceWisprAutomationState(waiting, {
		type: 'wisprTapSucceeded',
	});
	assert.deepEqual(recording, {
		phase: 'recording',
		textBeforeStart: '',
	});
});

void test('second press stops recording and text change returns to idle', () => {
	const recording: WisprAutomationState = {
		phase: 'recording',
		textBeforeStart: 'before',
	};

	const stopping = reduceWisprAutomationState(recording, { type: 'press' });
	assert.deepEqual(stopping, {
		phase: 'stopping',
		textBeforeStart: 'before',
	});

	const waiting = reduceWisprAutomationState(stopping, {
		type: 'wisprTapSucceeded',
	});
	assert.deepEqual(waiting, {
		phase: 'waitingForText',
		textBeforeStart: 'before',
	});

	const done = reduceWisprAutomationState(waiting, {
		type: 'textChanged',
		value: 'before dictated text',
	});
	assert.deepEqual(done, { phase: 'idle' });
});

void test('timeout records a retryable failure', () => {
	const waiting: WisprAutomationState = {
		phase: 'waitingForBubble',
		textBeforeStart: '',
	};

	const failed = reduceWisprAutomationState(waiting, {
		type: 'failed',
		reason: 'bubble-not-found',
		message: 'Wispr bubble not found',
	});

	assert.deepEqual(failed, {
		phase: 'failed',
		reason: 'bubble-not-found',
		message: 'Wispr bubble not found',
	});
});
