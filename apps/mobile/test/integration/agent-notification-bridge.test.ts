import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentNotificationBridgeStateMachine,
	HEARTBEAT_STALE_MS,
} from '../../src/lib/agent-notification-bridge';

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
