import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationDedupe,
	buildAgentNotificationListenCommand,
	createAgentNotificationPendingKey,
	createStableNotificationId,
	getAgentAlertNotificationText,
	handleAgentNotificationEvent,
	matchesAgentNotificationPendingKey,
	parseAgentNotificationLine,
	shouldAdvanceAgentNotificationCursorAfterPost,
} from '../../src/lib/agent-notification-events';

void test('agent alert notification text avoids window identity', () => {
	assert.deepEqual(
		getAgentAlertNotificationText({
			id: 'main:@12:1000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'secret-project',
			status: 'waiting',
			icon: '💬',
			createdAtMs: 1000,
		}),
		{
			title: 'Agent waiting',
			message: 'Agent status changed',
		},
	);
});

void test('parseAgentNotificationLine accepts tmux status events and heartbeats', () => {
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				id: 'main:@12:1000:waiting',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'fressh',
				status: 'waiting',
				icon: '💬',
				createdAtMs: 1000,
			}),
		),
		{
			id: 'main:@12:1000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'waiting',
			icon: '💬',
			createdAtMs: 1000,
		},
	);
	assert.deepEqual(
		parseAgentNotificationLine(
			'{"type":"heartbeat","session":"main","createdAtMs":2000}',
		),
		{ type: 'heartbeat', session: 'main', createdAtMs: 2000 },
	);
});

void test('parseAgentNotificationLine treats event ids as opaque strings', () => {
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				id: 'main:@12:1000:status:random-suffix',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'fressh',
				status: 'done',
				icon: '✅',
				createdAtMs: 1000,
			}),
		),
		{
			id: 'main:@12:1000:status:random-suffix',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'done',
			icon: '✅',
			createdAtMs: 1000,
		},
	);
});

void test('parseAgentNotificationLine rejects malformed lines', () => {
	assert.equal(parseAgentNotificationLine('not json'), null);
	assert.equal(parseAgentNotificationLine('{"type":"tmux_status"}'), null);
	assert.equal(
		parseAgentNotificationLine(
			'{"type":"tmux_status","status":"working","icon":"🤖"}',
		),
		null,
	);
});

void test('parseAgentNotificationLine rejects invalid heartbeat timestamps', () => {
	const invalidLines = [
		'{"type":"heartbeat","session":"main","createdAtMs":1e999}',
		JSON.stringify({
			type: 'heartbeat',
			session: 'main',
			createdAtMs: 1000.5,
		}),
		JSON.stringify({
			type: 'heartbeat',
			session: 'main',
			createdAtMs: -1,
		}),
		JSON.stringify({
			type: 'heartbeat',
			session: 'main',
			createdAtMs: '1000',
		}),
		JSON.stringify({
			type: 'heartbeat',
			session: 'main',
		}),
	];
	for (const line of invalidLines) {
		assert.equal(parseAgentNotificationLine(line), null);
	}
});

void test('parseAgentNotificationLine rejects invalid tmux status timestamps', () => {
	const buildLine = (createdAtMs: string): string =>
		[
			'{"id":"main:@12:1000:waiting"',
			',"type":"tmux_status"',
			',"session":"main"',
			',"target":"main:4"',
			',"windowId":"@12"',
			',"windowIndex":"4"',
			',"windowName":"fressh"',
			',"status":"waiting"',
			',"icon":"💬"',
			`,"createdAtMs":${createdAtMs}}`,
		].join('');
	const invalidLines = [
		buildLine('1e999'),
		buildLine('1000.5'),
		buildLine('-1'),
		buildLine('"1000"'),
		JSON.stringify({
			id: 'main:@12:1000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'waiting',
			icon: '💬',
		}),
	];
	for (const line of invalidLines) {
		assert.equal(parseAgentNotificationLine(line), null);
	}
});

void test('parseAgentNotificationLine accepts remote timestamps ahead of device clock', () => {
	const createdAtMs = 4_102_444_800_000;
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				type: 'heartbeat',
				session: 'main',
				createdAtMs,
			}),
		),
		{ type: 'heartbeat', session: 'main', createdAtMs },
	);
	assert.deepEqual(
		parseAgentNotificationLine(
			JSON.stringify({
				id: 'main:@12:1000:waiting',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'fressh',
				status: 'waiting',
				icon: '💬',
				createdAtMs,
			}),
		),
		{
			id: 'main:@12:1000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'fressh',
			status: 'waiting',
			icon: '💬',
			createdAtMs,
		},
	);
});

void test('listen command quotes session and since id', () => {
	assert.equal(
		buildAgentNotificationListenCommand("main'quoted"),
		"mdev tmux notifications listen --session 'main'\\''quoted'",
	);
	assert.equal(
		buildAgentNotificationListenCommand('main', "main:@12:1:'bad"),
		"mdev tmux notifications listen --session 'main' --since-id 'main:@12:1:'\\''bad'",
	);
});

void test('pending keys and notification ids are stable', () => {
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	assert.equal(key, '["conn-1","main","@12"]');
	assert.equal(
		createStableNotificationId(key),
		createStableNotificationId(key),
	);
	assert.ok(createStableNotificationId(key) > 0);
	assert.ok(createStableNotificationId(key) <= 0x7fffffff);
	assert.notEqual(
		createStableNotificationId(key),
		createStableNotificationId(
			createAgentNotificationPendingKey({
				connectionId: 'conn-1',
				session: 'main',
				windowId: '@13',
			}),
		),
	);

	const oldZeroIdKey = String.fromCharCode(2949, 34496);
	assert.equal(createStableNotificationId(oldZeroIdKey), 1);
});

void test('pending keys are unambiguous when values contain delimiters', () => {
	assert.notEqual(
		createAgentNotificationPendingKey({
			connectionId: 'a|b',
			session: 'c',
			windowId: 'd',
		}),
		createAgentNotificationPendingKey({
			connectionId: 'a',
			session: 'b|c',
			windowId: 'd',
		}),
	);
});

void test('dedupe posts once until matching key is acknowledged', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(dedupe.markPendingIfNew(key, 42), true);
	assert.equal(dedupe.markPendingIfNew(key, 42), false);
	assert.deepEqual(dedupe.acknowledge(key), [42]);
	assert.equal(dedupe.markPendingIfNew(key, 42), true);
});

void test('dedupe acknowledges matching pending keys', () => {
	const dedupe = new AgentNotificationDedupe();
	const conn1Main12 = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const conn1Main13 = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@13',
	});
	const conn2Main12 = createAgentNotificationPendingKey({
		connectionId: 'conn-2',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(dedupe.markPendingIfNew(conn1Main12, 42), true);
	assert.equal(dedupe.markPendingIfNew(conn1Main13, 43), true);
	assert.equal(dedupe.markPendingIfNew(conn2Main12, 44), true);

	assert.deepEqual(
		dedupe.acknowledgeMatching(
			(key) => key === conn1Main12 || key === conn1Main13,
		),
		[42, 43],
	);
	assert.equal(dedupe.markPendingIfNew(conn1Main12, 42), true);
	assert.equal(dedupe.markPendingIfNew(conn2Main12, 44), false);
});

void test('pending key matching includes tmux session identity', () => {
	const conn1Main12 = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});

	assert.equal(
		matchesAgentNotificationPendingKey(conn1Main12, {
			connectionId: 'conn-1',
			session: 'main',
			windowId: '@12',
		}),
		true,
	);
	assert.equal(
		matchesAgentNotificationPendingKey(conn1Main12, {
			connectionId: 'conn-1',
			session: 'other',
			windowId: '@12',
		}),
		false,
	);
});

void test('post completion advances cursor for visible acknowledgement race', () => {
	assert.equal(
		shouldAdvanceAgentNotificationCursorAfterPost({
			posted: true,
			completion: { type: 'cancel-posted', notificationId: 42 },
			currentEventId: null,
			eventId: 'main:@12:1000:waiting',
		}),
		true,
	);
	assert.equal(
		shouldAdvanceAgentNotificationCursorAfterPost({
			posted: false,
			completion: { type: 'ignored' },
			currentEventId: null,
			eventId: 'main:@12:1000:waiting',
		}),
		false,
	);
});

void test('handleAgentNotificationEvent signals and handles new pending events once', () => {
	const dedupe = new AgentNotificationDedupe();
	const event = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	let signalCount = 0;
	const pending: { key: string; notificationId: number }[] = [];

	const input = {
		event,
		connectionId: 'conn-1',
		dedupe,
		notifyPending: () => {
			signalCount += 1;
		},
		onPending: ({
			key,
			notificationId,
		}: {
			key: string;
			notificationId: number;
		}) => {
			pending.push({ key, notificationId });
		},
	};

	handleAgentNotificationEvent(input);
	handleAgentNotificationEvent(input);

	const expectedKey = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	assert.equal(signalCount, 1);
	assert.deepEqual(pending, [
		{
			key: expectedKey,
			notificationId: createStableNotificationId(expectedKey),
		},
	]);
});

void test('handleAgentNotificationEvent handles later status updates for the same window', () => {
	const dedupe = new AgentNotificationDedupe();
	const baseEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...baseEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};
	let signalCount = 0;
	const handledStatuses: string[] = [];

	for (const event of [baseEvent, baseEvent, doneEvent]) {
		handleAgentNotificationEvent({
			event,
			connectionId: 'conn-1',
			dedupe,
			notifyPending: () => {
				signalCount += 1;
			},
			onPending: ({ event: pendingEvent }) => {
				handledStatuses.push(pendingEvent.status);
			},
		});
	}

	assert.equal(signalCount, 2);
	assert.deepEqual(handledStatuses, ['waiting', 'done']);
});

void test('dedupe ignores stale post completions without clearing newer status', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const waitingEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...waitingEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(
		dedupe.markPendingEvent(key, notificationId, waitingEvent),
		true,
	);
	const waitingAttemptId = dedupe.beginPost(key, waitingEvent.id);
	assert.equal(waitingAttemptId, 1);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
	assert.deepEqual(dedupe.completePost(key, waitingEvent.id, 1, false), {
		type: 'ignored',
	});
	assert.deepEqual(dedupe.completePost(key, waitingEvent.id, 1, true), {
		type: 'superseded',
		posted: true,
			current: {
				key,
				notificationId,
				event: doneEvent,
				resumeKey: 'saved-host:main',
			},
	});
	const doneAttemptId = dedupe.beginPost(key, doneEvent.id);
	assert.equal(doneAttemptId, 1);
	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, doneAttemptId!, true),
		{
			type: 'posted',
		},
	);
	assert.deepEqual(dedupe.acknowledge(key), [notificationId]);
});

void test('dedupe ignores duplicate current failure while another current post is in flight', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const waitingEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...waitingEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(
		dedupe.markPendingEvent(key, notificationId, waitingEvent),
		true,
	);
	const waitingAttemptId = dedupe.beginPost(key, waitingEvent.id);
	assert.equal(waitingAttemptId, 1);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
	const doneAttemptId = dedupe.beginPost(key, doneEvent.id);
	assert.equal(doneAttemptId, 1);
	assert.deepEqual(dedupe.completePost(key, waitingEvent.id, 1, true), {
		type: 'ignored',
	});
	const duplicateDoneAttemptId = dedupe.beginPost(key, doneEvent.id);
	assert.equal(duplicateDoneAttemptId, 2);
	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, duplicateDoneAttemptId!, false),
		{
			type: 'ignored',
		},
	);
	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, doneAttemptId!, true),
		{
			type: 'ignored',
		},
	);
	assert.deepEqual(dedupe.acknowledge(key), [notificationId]);
});

void test('dedupe retries unposted current event after stale notification update fails', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const waitingEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...waitingEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(
		dedupe.markPendingEvent(key, notificationId, waitingEvent),
		true,
	);
	const waitingAttemptId = dedupe.beginPost(key, waitingEvent.id);
	assert.equal(waitingAttemptId, 1);
	assert.deepEqual(
		dedupe.completePost(key, waitingEvent.id, waitingAttemptId!, true),
		{
			type: 'posted',
		},
	);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
	const doneAttemptId = dedupe.beginPost(key, doneEvent.id);
	assert.equal(doneAttemptId, 1);
	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, doneAttemptId!, false),
		{
			type: 'failed',
		},
	);
	assert.deepEqual(dedupe.getPendingEvent(key), {
		key,
		notificationId,
		event: doneEvent,
		resumeKey: 'saved-host:main',
	});
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
});

void test('dedupe retries current event failure even when stale post is in flight', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const waitingEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...waitingEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(
		dedupe.markPendingEvent(key, notificationId, waitingEvent),
		true,
	);
	const waitingAttemptId = dedupe.beginPost(key, waitingEvent.id);
	assert.equal(waitingAttemptId, 1);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
	const doneAttemptId = dedupe.beginPost(key, doneEvent.id);
	assert.equal(doneAttemptId, 1);

	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, doneAttemptId!, false),
		{
			type: 'failed',
		},
	);
	assert.deepEqual(
		dedupe.completePost(key, waitingEvent.id, waitingAttemptId!, false),
		{
			type: 'ignored',
		},
	);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
});

void test('dedupe ignores duplicate current failure while a stale post is in flight', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const waitingEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...waitingEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(
		dedupe.markPendingEvent(key, notificationId, waitingEvent),
		true,
	);
	const waitingAttemptId = dedupe.beginPost(key, waitingEvent.id);
	assert.equal(waitingAttemptId, 1);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
	const firstDoneAttemptId = dedupe.beginPost(key, doneEvent.id);
	const secondDoneAttemptId = dedupe.beginPost(key, doneEvent.id);

	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, secondDoneAttemptId!, false),
		{
			type: 'ignored',
		},
	);
	assert.deepEqual(
		dedupe.completePost(key, waitingEvent.id, waitingAttemptId!, false),
		{
			type: 'ignored',
		},
	);
	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, firstDoneAttemptId!, false),
		{
			type: 'failed',
		},
	);
});

void test('dedupe keeps initially failed events pending for local repost', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const event = {
		id: 'main:@12:2000:done',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
	const attemptId = dedupe.beginPost(key, event.id);
	assert.equal(attemptId, 1);
	assert.deepEqual(dedupe.completePost(key, event.id, attemptId!, false), {
		type: 'failed',
	});
	assert.deepEqual(dedupe.getPendingEvent(key), {
		key,
		notificationId,
		event,
		resumeKey: null,
	});
	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
});

void test('dedupe restores current event when stale post completes after current post', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const waitingEvent = {
		id: 'main:@12:1000:waiting',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'waiting' as const,
		icon: '💬' as const,
		createdAtMs: 1000,
	};
	const doneEvent = {
		...waitingEvent,
		id: 'main:@12:2000:done',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(
		dedupe.markPendingEvent(key, notificationId, waitingEvent),
		true,
	);
	const waitingAttemptId = dedupe.beginPost(key, waitingEvent.id);
	assert.equal(waitingAttemptId, 1);
	assert.equal(
		dedupe.markPendingEvent(
			key,
			notificationId,
			doneEvent,
			'saved-host:main',
		),
		true,
	);
	const doneAttemptId = dedupe.beginPost(key, doneEvent.id);
	assert.equal(doneAttemptId, 1);
	assert.deepEqual(
		dedupe.completePost(key, doneEvent.id, doneAttemptId!, true),
		{
			type: 'posted',
		},
	);
	assert.deepEqual(dedupe.completePost(key, waitingEvent.id, 1, true), {
		type: 'superseded',
		posted: true,
		current: {
			key,
			notificationId,
			event: doneEvent,
			resumeKey: 'saved-host:main',
		},
	});
});

void test('dedupe cancels native post that completes after acknowledgement', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const event = {
		id: 'main:@12:2000:done',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
	const attemptId = dedupe.beginPost(key, event.id);
	assert.equal(attemptId, 1);
	assert.deepEqual(dedupe.acknowledge(key), [notificationId]);
	assert.deepEqual(dedupe.completePost(key, event.id, attemptId!, true), {
		type: 'cancel-posted',
		notificationId,
	});
});

void test('dedupe exposes current pending events for route refresh after reconnect', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'saved-host',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const event = {
		id: 'main:@12:2000:done',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
	assert.deepEqual(dedupe.getPendingEvents(), [
		{ key, notificationId, event, resumeKey: null },
	]);
	assert.equal(
		dedupe.markPendingEvent(key, notificationId, event, 'saved-host:main'),
		false,
	);
	assert.deepEqual(dedupe.getPendingEvent(key), {
		key,
		notificationId,
		event,
		resumeKey: 'saved-host:main',
	});
	assert.deepEqual(dedupe.acknowledge(key), [notificationId]);
	assert.deepEqual(dedupe.getPendingEvents(), []);
});

void test('dedupe cancels native post that completes after pending state is cleared', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const event = {
		id: 'main:@12:2000:done',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
	const attemptId = dedupe.beginPost(key, event.id);
	assert.equal(attemptId, 1);
	assert.deepEqual(dedupe.clear(), [notificationId]);
	assert.deepEqual(dedupe.completePost(key, event.id, attemptId!, true), {
		type: 'cancel-posted',
		notificationId,
	});
});

void test('dedupe keeps posted status when an older same-event attempt fails', () => {
	const dedupe = new AgentNotificationDedupe();
	const key = createAgentNotificationPendingKey({
		connectionId: 'conn-1',
		session: 'main',
		windowId: '@12',
	});
	const notificationId = createStableNotificationId(key);
	const event = {
		id: 'main:@12:2000:done',
		type: 'tmux_status' as const,
		session: 'main',
		target: 'main:4',
		windowId: '@12',
		windowIndex: '4',
		windowName: 'fressh',
		status: 'done' as const,
		icon: '✅' as const,
		createdAtMs: 2000,
	};

	assert.equal(dedupe.markPendingEvent(key, notificationId, event), true);
	const firstAttemptId = dedupe.beginPost(key, event.id);
	const secondAttemptId = dedupe.beginPost(key, event.id);
	assert.equal(firstAttemptId, 1);
	assert.equal(secondAttemptId, 2);
	assert.deepEqual(dedupe.completePost(key, event.id, secondAttemptId!, true), {
		type: 'posted',
	});
	assert.deepEqual(dedupe.completePost(key, event.id, firstAttemptId!, false), {
		type: 'ignored',
	});
	assert.deepEqual(dedupe.acknowledge(key), [notificationId]);
});
