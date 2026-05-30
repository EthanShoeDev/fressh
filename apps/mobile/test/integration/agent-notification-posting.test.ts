import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationDedupe,
	createAgentNotificationPendingKey,
	createStableNotificationId,
	type AgentNotificationEvent,
} from '../../src/lib/agent-notification-events';
import { type AgentAlertNotificationInput } from '../../src/lib/agent-notification-native';
import { postAgentNotificationWithRouteToken } from '../../src/lib/agent-notification-posting';

function createEvent(id = 'main:@12:2000:waiting'): AgentNotificationEvent {
	return {
		id,
		type: 'tmux_status',
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'secret',
		status: 'waiting',
		icon: '💬',
		createdAtMs: 2000,
	};
}

function createPendingPostHarness(event = createEvent()) {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'saved-host',
		session: event.session,
		windowId: event.windowId,
	});
	const notificationId = createStableNotificationId(key);
	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
	return { dedupe, event, key, notificationId };
}

void test('postAgentNotificationWithRouteToken passes generated tap token to native post', async () => {
	const harness = createPendingPostHarness();
	const nativePosts: AgentAlertNotificationInput[] = [];
	const deletedTokens: unknown[] = [];

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: (identity) => {
				assert.deepEqual(identity, {
					connectionId: 'saved-host',
					session: 'main',
					windowId: '@12',
					eventId: 'main:@12:2000:waiting',
				});
				return 'tap-token';
			},
			deleteRouteToken: (input) => {
				deletedTokens.push(input);
			},
			postAgentAlertNotification: async (input) => {
				nativePosts.push(input);
				return true;
			},
		},
	});

	assert.equal(result?.posted, true);
	assert.equal(result?.shouldAdvanceCursor, true);
	assert.equal(result?.completion.type, 'posted');
	assert.equal(nativePosts.length, 1);
	assert.equal(nativePosts[0]?.tapToken, 'tap-token');
	assert.equal(nativePosts[0]?.notificationConnectionId, 'saved-host');
	assert.deepEqual(deletedTokens, []);
});

void test('postAgentNotificationWithRouteToken forwards vibration preference to native post', async () => {
	const harness = createPendingPostHarness();
	const nativePosts: AgentAlertNotificationInput[] = [];

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		vibrate: false,
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: () => {},
			postAgentAlertNotification: async (input) => {
				nativePosts.push(input);
				return true;
			},
		},
	});

	assert.equal(result?.posted, true);
	assert.equal(nativePosts.length, 1);
	assert.equal(nativePosts[0]?.vibrate, false);
});

void test('postAgentNotificationWithRouteToken deletes tap token when native post fails', async () => {
	const harness = createPendingPostHarness();
	const deletedTokens: unknown[] = [];

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: (input) => {
				deletedTokens.push(input);
			},
			postAgentAlertNotification: async () => false,
		},
	});

	assert.equal(result?.posted, false);
	assert.equal(result?.completion.type, 'failed');
	assert.deepEqual(deletedTokens, [
		{
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'tap-token',
		},
	]);
});

void test('postAgentNotificationWithRouteToken keeps tap token when native post times out', async () => {
	const harness = createPendingPostHarness();
	const deletedTokens: unknown[] = [];
	const warnings: unknown[] = [];

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: (input) => {
				deletedTokens.push(input);
			},
			postAgentAlertNotification: () => new Promise<boolean>(() => {}),
			postTimeoutMs: 1,
			warn: (_message, error) => {
				warnings.push(error);
			},
		},
	});

	assert.equal(result?.posted, false);
	assert.equal(result?.completion.type, 'failed');
	assert.equal(deletedTokens.length, 0);
	assert.equal(warnings.length, 1);
});

void test('postAgentNotificationWithRouteToken deletes tap token when native post throws', async () => {
	const harness = createPendingPostHarness();
	const deletedTokens: unknown[] = [];
	const warnings: unknown[] = [];

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: (input) => {
				deletedTokens.push(input);
			},
			postAgentAlertNotification: async () => {
				throw new Error('native post failed');
			},
			warn: (_message, error) => {
				warnings.push(error);
			},
		},
	});

	assert.equal(result?.posted, false);
	assert.equal(result?.completion.type, 'failed');
	assert.equal(deletedTokens.length, 1);
	assert.equal(warnings.length, 1);
});

void test('postAgentNotificationWithRouteToken warns when failed post cleanup throws', async () => {
	const harness = createPendingPostHarness();
	const warnings: unknown[] = [];

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: () => {
				throw new Error('cleanup failed');
			},
			postAgentAlertNotification: async () => false,
			warn: (_message, error) => {
				warnings.push(error);
			},
		},
	});

	assert.equal(result?.posted, false);
	assert.equal(result?.completion.type, 'failed');
	assert.equal(warnings.length, 1);
});

void test('postAgentNotificationWithRouteToken ignores duplicate or non-current posts before creating a token', async () => {
	const event = createEvent();
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'saved-host',
		session: event.session,
		windowId: event.windowId,
	});
	let createRouteTokenCalls = 0;
	let nativePostCalls = 0;
	let deleteRouteTokenCalls = 0;

	const result = await postAgentNotificationWithRouteToken({
		key,
		notificationId: createStableNotificationId(key),
		event,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dedupe,
		dependencies: {
			createRouteToken: () => {
				createRouteTokenCalls += 1;
				return 'tap-token';
			},
			deleteRouteToken: () => {
				deleteRouteTokenCalls += 1;
			},
			postAgentAlertNotification: async () => {
				nativePostCalls += 1;
				return true;
			},
		},
	});

	assert.equal(result, null);
	assert.equal(createRouteTokenCalls, 0);
	assert.equal(nativePostCalls, 0);
	assert.equal(deleteRouteTokenCalls, 0);
});

void test('postAgentNotificationWithRouteToken ignores stale posts before creating a token', async () => {
	const event = createEvent('main:@12:2000:waiting');
	const currentEvent = createEvent('main:@12:3000:done');
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'saved-host',
		session: event.session,
		windowId: event.windowId,
	});
	const notificationId = createStableNotificationId(key);
	assert.equal(dedupe.markPendingEvent(key, notificationId, currentEvent), true);
	let createRouteTokenCalls = 0;
	let nativePostCalls = 0;

	const result = await postAgentNotificationWithRouteToken({
		key,
		notificationId,
		event,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dedupe,
		dependencies: {
			createRouteToken: () => {
				createRouteTokenCalls += 1;
				return 'tap-token';
			},
			deleteRouteToken: () => {},
			postAgentAlertNotification: async () => {
				nativePostCalls += 1;
				return true;
			},
		},
	});

	assert.equal(result, null);
	assert.equal(createRouteTokenCalls, 0);
	assert.equal(nativePostCalls, 0);
});

void test('postAgentNotificationWithRouteToken does not clear newer route tokens after stale post success', async () => {
	const waiting = createEvent('main:@12:2000:waiting');
	const done = createEvent('main:@12:3000:done');
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'saved-host',
		session: waiting.session,
		windowId: waiting.windowId,
	});
	const notificationId = createStableNotificationId(key);
	assert.equal(dedupe.markPendingEvent(key, notificationId, waiting), true);
	let resolveWaiting!: (posted: boolean) => void;
	const waitingPost = postAgentNotificationWithRouteToken({
		key,
		notificationId,
		event: waiting,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dedupe,
		dependencies: {
			createRouteToken: () => 'waiting-token',
			deleteRouteToken: () => {},
			postAgentAlertNotification: () =>
				new Promise<boolean>((resolve) => {
					resolveWaiting = resolve;
				}),
		},
	});
	assert.equal(dedupe.markPendingEvent(key, notificationId, done), true);
	let deletedTokens = 0;
	const doneResult = await postAgentNotificationWithRouteToken({
		key,
		notificationId,
		event: done,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dedupe,
		dependencies: {
			createRouteToken: () => 'done-token',
			deleteRouteToken: () => {
				deletedTokens += 1;
			},
			postAgentAlertNotification: async () => true,
		},
	});

	resolveWaiting(true);
	const waitingResult = await waitingPost;

	assert.equal(doneResult?.completion.type, 'posted');
	assert.equal(waitingResult?.completion.type, 'superseded');
	assert.equal(deletedTokens, 0);
});

void test('postAgentNotificationWithRouteToken deletes tap token when successful post completes after acknowledgement', async () => {
	const harness = createPendingPostHarness();
	const deletedTokens: unknown[] = [];
	let resolvePost!: (posted: boolean) => void;

	const pendingPost = postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: (input) => {
				deletedTokens.push(input);
			},
			postAgentAlertNotification: () =>
				new Promise<boolean>((resolve) => {
					resolvePost = resolve;
				}),
		},
	});
	assert.deepEqual(harness.dedupe.acknowledge(harness.key), [
		harness.notificationId,
	]);
	resolvePost(true);
	const result = await pendingPost;

	assert.equal(result?.posted, true);
	assert.equal(result?.completion.type, 'cancel-posted');
	assert.deepEqual(deletedTokens, [
		{
			connectionId: 'saved-host',
			session: 'main',
			windowId: '@12',
			eventId: 'main:@12:2000:waiting',
			tapToken: 'tap-token',
		},
	]);
});

void test('postAgentNotificationWithRouteToken warns when cancel-posted token cleanup throws', async () => {
	const harness = createPendingPostHarness();
	const warnings: unknown[] = [];
	let resolvePost!: (posted: boolean) => void;

	const pendingPost = postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => 'tap-token',
			deleteRouteToken: () => {
				throw new Error('cleanup failed');
			},
			postAgentAlertNotification: () =>
				new Promise<boolean>((resolve) => {
					resolvePost = resolve;
				}),
			warn: (_message, error) => {
				warnings.push(error);
			},
		},
	});
	harness.dedupe.clear();
	resolvePost(true);
	const result = await pendingPost;

	assert.equal(result?.posted, true);
	assert.equal(result?.completion.type, 'cancel-posted');
	assert.equal(warnings.length, 1);
});

void test('postAgentNotificationWithRouteToken completes failed attempt when route token creation throws', async () => {
	const harness = createPendingPostHarness();
	const warnings: unknown[] = [];
	let nativePostCount = 0;

	const result = await postAgentNotificationWithRouteToken({
		...harness,
		connectionId: 'runtime-connection',
		channelId: 7,
		notificationConnectionId: 'saved-host',
		dependencies: {
			createRouteToken: () => {
				throw new Error('storage unavailable');
			},
			deleteRouteToken: () => {
				throw new Error('should not delete without token');
			},
			postAgentAlertNotification: async () => {
				nativePostCount += 1;
				return true;
			},
			warn: (_message, error) => {
				warnings.push(error);
			},
		},
	});

	assert.equal(nativePostCount, 0);
	assert.equal(result?.posted, false);
	assert.equal(result?.completion.type, 'failed');
	assert.equal(warnings.length, 1);
});
