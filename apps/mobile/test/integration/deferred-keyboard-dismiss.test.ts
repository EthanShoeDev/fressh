import assert from 'node:assert/strict';
import test from 'node:test';

import { closeThenDismissKeyboard } from '../../src/lib/deferred-keyboard-dismiss';

void test('closes immediately and defers keyboard dismissal', () => {
	const calls: string[] = [];
	let scheduledDismiss: (() => void) | undefined;

	closeThenDismissKeyboard({
		close: () => {
			calls.push('close');
		},
		dismissKeyboard: () => {
			calls.push('dismiss');
		},
		schedule: (callback) => {
			calls.push('schedule');
			scheduledDismiss = callback;
		},
	});

	assert.deepEqual(calls, ['close', 'schedule']);

	scheduledDismiss?.();

	assert.deepEqual(calls, ['close', 'schedule', 'dismiss']);
});
