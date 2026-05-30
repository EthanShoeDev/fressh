import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAgentNotificationRoutesSafely } from '../../src/lib/agent-notification-bridge';

void test('clearAgentNotificationRoutesSafely clears route tokens even without notification ids', () => {
	let clearCalls = 0;

	clearAgentNotificationRoutesSafely({
		clearRouteTokens: () => {
			clearCalls += 1;
		},
		warn: () => {},
	});

	assert.equal(clearCalls, 1);
});

void test('clearAgentNotificationRoutesSafely catches storage failures', () => {
	const warnings: unknown[] = [];

	assert.doesNotThrow(() => {
		clearAgentNotificationRoutesSafely({
			clearRouteTokens: () => {
				throw new Error('storage failed');
			},
			warn: (_message, error) => {
				warnings.push(error);
			},
		});
	});

	assert.equal(warnings.length, 1);
});
