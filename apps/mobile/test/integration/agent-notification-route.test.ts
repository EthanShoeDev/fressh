import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentNotificationPendingKey,
	createStableNotificationId,
} from '../../src/lib/agent-notification-events';
import { acknowledgeRoutedAgentNotificationWithDependencies } from '../../src/lib/agent-notification-route';

void test('routed agent acknowledgement cleans tokens and cancels bridge notification ids', () => {
	const deleted: unknown[] = [];
	const cancelled: number[] = [];

	acknowledgeRoutedAgentNotificationWithDependencies(
		{
			deleteRouteTokens: (input) => {
				deleted.push(input);
			},
			acknowledgeBridge: () => [123, 456],
			cancelNotification: (notificationId) => {
				cancelled.push(notificationId);
			},
			warn: () => {},
		},
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	);

	assert.deepEqual(deleted, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	]);
	assert.deepEqual(cancelled, [123, 456]);
});

void test('routed agent acknowledgement cancels stable id after cold start', () => {
	const cancelled: number[] = [];

	acknowledgeRoutedAgentNotificationWithDependencies(
		{
			deleteRouteTokens: () => {},
			acknowledgeBridge: () => [],
			cancelNotification: (notificationId) => {
				cancelled.push(notificationId);
			},
			warn: () => {},
		},
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	);

	assert.deepEqual(cancelled, [
		createStableNotificationId(
			createAgentNotificationPendingKey({
				connectionId: 'saved-host',
				session: 'main',
				windowId: '@12',
			}),
		),
	]);
});

void test('routed agent acknowledgement still cancels when token cleanup fails', () => {
	const warnings: unknown[] = [];
	const cancelled: number[] = [];

	acknowledgeRoutedAgentNotificationWithDependencies(
		{
			deleteRouteTokens: () => {
				throw new Error('cleanup failed');
			},
			acknowledgeBridge: () => [123],
			cancelNotification: (notificationId) => {
				cancelled.push(notificationId);
			},
			warn: (_message, error) => {
				warnings.push(error);
			},
		},
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	);

	assert.deepEqual(cancelled, [123]);
	assert.equal(warnings.length, 1);
});
