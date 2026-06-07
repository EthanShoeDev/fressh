import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isFocusedActiveRequestCurrent,
	shouldShowFocusedActiveFeedback,
} from '../../src/lib/focused-active-request';

void test('focused active feedback is suppressed after blur or app inactive', () => {
	assert.equal(
		shouldShowFocusedActiveFeedback({
			isFocused: true,
			isAppActive: true,
		}),
		true,
	);
	assert.equal(
		shouldShowFocusedActiveFeedback({
			isFocused: false,
			isAppActive: true,
		}),
		false,
	);
	assert.equal(
		shouldShowFocusedActiveFeedback({
			isFocused: true,
			isAppActive: false,
		}),
		false,
	);
});

void test('focused active request requires current request and visible app state', () => {
	assert.equal(
		isFocusedActiveRequestCurrent({
			requestId: 2,
			isCurrentRequest: (id) => id === 2,
			isFocused: true,
			isAppActive: true,
		}),
		true,
	);
	assert.equal(
		isFocusedActiveRequestCurrent({
			requestId: 1,
			isCurrentRequest: (id) => id === 2,
			isFocused: true,
			isAppActive: true,
		}),
		false,
	);
	assert.equal(
		isFocusedActiveRequestCurrent({
			requestId: 2,
			isCurrentRequest: (id) => id === 2,
			isFocused: true,
			isAppActive: false,
		}),
		false,
	);
});
