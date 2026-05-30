import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationBridgeStateMachine,
	handleAgentNotificationListenerLine,
	HEARTBEAT_STALE_MS,
} from '../../src/lib/agent-notification-bridge';
import { AgentNotificationDedupe } from '../../src/lib/agent-notification-events';

void test('bridge state transitions through start, heartbeat, stale, and stopped', () => {
	const bridge = new AgentNotificationBridgeStateMachine();

	assert.deepEqual(bridge.state, {
		status: 'inactive',
		lastHeartbeatAtMs: null,
		lastSeenId: null,
	});

	bridge.markStarting();
	assert.deepEqual(bridge.state, {
		status: 'starting',
		lastHeartbeatAtMs: null,
		lastSeenId: null,
	});

	bridge.recordHeartbeat(1_000);
	assert.deepEqual(bridge.state, {
		status: 'active',
		lastHeartbeatAtMs: 1_000,
		lastSeenId: null,
	});

	bridge.checkHeartbeat(1_000 + HEARTBEAT_STALE_MS - 1);
	assert.deepEqual(bridge.state, {
		status: 'active',
		lastHeartbeatAtMs: 1_000,
		lastSeenId: null,
	});

	bridge.checkHeartbeat(1_000 + HEARTBEAT_STALE_MS);
	assert.deepEqual(bridge.state, {
		status: 'degraded',
		lastHeartbeatAtMs: 1_000,
		lastSeenId: null,
	});

	bridge.markStoppedByOsOrConnection();
	assert.deepEqual(bridge.state, {
		status: 'stopped-by-os-or-connection',
		lastHeartbeatAtMs: 1_000,
		lastSeenId: null,
	});
});

void test('checkHeartbeat does not degrade without a heartbeat', () => {
	const bridge = new AgentNotificationBridgeStateMachine();

	bridge.markStarting();
	bridge.checkHeartbeat(HEARTBEAT_STALE_MS);

	assert.deepEqual(bridge.state, {
		status: 'starting',
		lastHeartbeatAtMs: null,
		lastSeenId: null,
	});
});

void test('checkHeartbeat does not overwrite inactive or stopped states', () => {
	const inactiveBridge = new AgentNotificationBridgeStateMachine();

	inactiveBridge.recordHeartbeat(1_000);
	inactiveBridge.markInactive();
	inactiveBridge.checkHeartbeat(1_000 + HEARTBEAT_STALE_MS);

	assert.deepEqual(inactiveBridge.state, {
		status: 'inactive',
		lastHeartbeatAtMs: 1_000,
		lastSeenId: null,
	});

	const stoppedBridge = new AgentNotificationBridgeStateMachine();

	stoppedBridge.recordHeartbeat(2_000);
	stoppedBridge.markStoppedByOsOrConnection();
	stoppedBridge.checkHeartbeat(2_000 + HEARTBEAT_STALE_MS);

	assert.deepEqual(stoppedBridge.state, {
		status: 'stopped-by-os-or-connection',
		lastHeartbeatAtMs: 2_000,
		lastSeenId: null,
	});
});

void test('bridge records the last seen event id independently of status', () => {
	const bridge = new AgentNotificationBridgeStateMachine();

	bridge.recordEventId('main:@12:1000:waiting');
	assert.deepEqual(bridge.state, {
		status: 'inactive',
		lastHeartbeatAtMs: null,
		lastSeenId: 'main:@12:1000:waiting',
	});

	bridge.recordHeartbeat(2_000);
	bridge.recordEventId('main:@12:2000:done');
	bridge.markDegraded();
	bridge.markInactive();

	assert.deepEqual(bridge.state, {
		status: 'inactive',
		lastHeartbeatAtMs: 2_000,
		lastSeenId: 'main:@12:2000:done',
	});
});

type PendingPost = Parameters<
	Parameters<
		typeof handleAgentNotificationListenerLine
	>[0]['postPendingNotification']
>[0];

void test('handleAgentNotificationListenerLine wires tmux event to pending native post data', () => {
	const bridge = new AgentNotificationBridgeStateMachine();
	const dedupe = new AgentNotificationDedupe();
	const lastSeen = new Map<string, string>();
	const pendingPosts: PendingPost[] = [];
	let pendingNotifications = 0;

	handleAgentNotificationListenerLine({
		line: JSON.stringify({
			id: 'main:@12:2000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'work',
			status: 'waiting',
			icon: '💬',
			createdAtMs: 2000,
		}),
		activeTarget: {
			key: 'runtime-conn:shell:main',
			resumeKey: 'saved-host:main',
			connectionId: 'runtime-conn',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		currentTargetKey: 'runtime-conn:shell:main',
		nowMs: 10_000,
		bridge,
		lastSeenIdByTarget: lastSeen,
		dedupe,
		notifyPending: () => {
			pendingNotifications += 1;
		},
		postPendingNotification: (input) => {
			pendingPosts.push(input);
		},
		warn: () => {},
	});

	assert.equal(bridge.state.lastSeenId, null);
	assert.equal(lastSeen.get('saved-host:main'), undefined);
	assert.equal(pendingNotifications, 1);
	assert.deepEqual(pendingPosts, [
		{
			key: '["saved-host","main","@12"]',
			notificationId: pendingPosts[0]?.['notificationId'],
			event: {
				id: 'main:@12:2000:waiting',
				type: 'tmux_status',
				session: 'main',
				target: 'main:4',
				windowId: '@12',
				windowIndex: '4',
				windowName: 'work',
				status: 'waiting',
				icon: '💬',
				createdAtMs: 2000,
			},
			targetKey: 'runtime-conn:shell:main',
			connectionId: 'runtime-conn',
			channelId: 7,
			notificationConnectionId: 'saved-host',
			onPosted: pendingPosts[0]?.['onPosted'],
		},
	]);

	pendingPosts[0]?.onPosted(true);
	assert.equal(bridge.state.lastSeenId, 'main:@12:2000:waiting');
	assert.equal(lastSeen.get('saved-host:main'), 'main:@12:2000:waiting');
});

void test('handleAgentNotificationListenerLine keeps resume cursor unchanged after post failure', () => {
	const bridge = new AgentNotificationBridgeStateMachine();
	const dedupe = new AgentNotificationDedupe();
	const lastSeen = new Map<string, string>();
	const pendingPosts: PendingPost[] = [];

	handleAgentNotificationListenerLine({
		line: JSON.stringify({
			id: 'main:@12:2000:waiting',
			type: 'tmux_status',
			session: 'main',
			target: 'main:4',
			windowId: '@12',
			windowIndex: '4',
			windowName: 'work',
			status: 'waiting',
			icon: '💬',
			createdAtMs: 2000,
		}),
		activeTarget: {
			key: 'runtime-conn:shell:main',
			resumeKey: 'saved-host:main',
			connectionId: 'runtime-conn',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		currentTargetKey: 'runtime-conn:shell:main',
		nowMs: 10_000,
		bridge,
		lastSeenIdByTarget: lastSeen,
		dedupe,
		notifyPending: () => {},
		postPendingNotification: (input) => {
			pendingPosts.push(input);
		},
		warn: () => {},
	});

	pendingPosts[0]?.onPosted(false);

	assert.equal(bridge.state.lastSeenId, null);
	assert.equal(lastSeen.get('saved-host:main'), undefined);
});

void test('handleAgentNotificationListenerLine ignores stale targets and malformed lines', () => {
	const bridge = new AgentNotificationBridgeStateMachine();
	const dedupe = new AgentNotificationDedupe();
	const warnings: unknown[][] = [];
	let pendingNotifications = 0;

	handleAgentNotificationListenerLine({
		line: '{"type":"tmux_status"}',
		activeTarget: {
			key: 'runtime-conn:shell:main',
			resumeKey: 'saved-host:main',
			connectionId: 'runtime-conn',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		currentTargetKey: 'runtime-conn:shell:main',
		nowMs: 10_000,
		bridge,
		lastSeenIdByTarget: new Map(),
		dedupe,
		notifyPending: () => {
			pendingNotifications += 1;
		},
		postPendingNotification: () => {},
		warn: (...args) => warnings.push(args),
	});
	handleAgentNotificationListenerLine({
		line: JSON.stringify({
			type: 'heartbeat',
			session: 'main',
			createdAtMs: 2000,
		}),
		activeTarget: {
			key: 'runtime-conn:shell:main',
			resumeKey: 'saved-host:main',
			connectionId: 'runtime-conn',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		currentTargetKey: 'other-target',
		nowMs: 20_000,
		bridge,
		lastSeenIdByTarget: new Map(),
		dedupe,
		notifyPending: () => {
			pendingNotifications += 1;
		},
		postPendingNotification: () => {},
		warn: (...args) => warnings.push(args),
	});

	assert.equal(pendingNotifications, 0);
	assert.equal(bridge.state.lastHeartbeatAtMs, null);
	assert.deepEqual(warnings, [
		[
			'ignored malformed agent notification line',
			{ line: '{"type":"tmux_status"}' },
		],
	]);
});

void test('handleAgentNotificationListenerLine records active heartbeats', () => {
	const bridge = new AgentNotificationBridgeStateMachine();
	const dedupe = new AgentNotificationDedupe();
	let heartbeats = 0;

	handleAgentNotificationListenerLine({
		line: JSON.stringify({
			type: 'heartbeat',
			session: 'main',
			createdAtMs: 2000,
		}),
		activeTarget: {
			key: 'runtime-conn:shell:main',
			resumeKey: 'saved-host:main',
			connectionId: 'runtime-conn',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		currentTargetKey: 'runtime-conn:shell:main',
		nowMs: 20_000,
		bridge,
		lastSeenIdByTarget: new Map(),
		dedupe,
		notifyPending: () => {},
		onHeartbeat: () => {
			heartbeats += 1;
		},
		postPendingNotification: () => {},
		warn: () => {},
	});

	assert.equal(bridge.state.lastHeartbeatAtMs, 20_000);
	assert.equal(bridge.state.status, 'active');
	assert.equal(heartbeats, 1);
});
