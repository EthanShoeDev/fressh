import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AGENT_NOTIFICATION_RESTART_EXHAUSTED_PROBE_MS,
	createAgentNotificationPostRetryKey,
	createAgentNotificationPostRetryRepostInput,
	createAgentNotificationRepostInput,
	getAgentNotificationRestartDelay,
} from '../../src/lib/agent-notification-bridge';
import {
	canAttemptBackgroundReconnect,
	canRunAgentNotificationBridge,
	canRunAndroidBackgroundWork,
	createAgentNotificationCursorAdvanceOnPost,
	createAgentNotificationPostRetryCoordinator,
	createAgentNotificationRestartCoordinator,
	createForegroundServiceStartCoordinator,
	getForegroundServiceStartRetryDelay,
	getForegroundServiceNotificationMessage,
	getNextConfiguredResumeKey,
	shouldPreservePendingWithoutConfiguredTarget,
	shouldPreservePendingWithoutTarget,
	shouldPreserveForegroundServiceForShellDrop,
	shouldRunForegroundService,
	shouldStopReconnectOnBackground,
	shouldWaitForForegroundServiceCoverage,
	shouldClearPendingAgentNotifications,
	shouldClearPendingAgentNotificationsForResumeKeyChange,
} from '../../src/lib/foreground-service-runtime';

void test('foreground service notification message avoids connection identity', () => {
	assert.equal(
		getForegroundServiceNotificationMessage({
			hasConnection: true,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		'SSH session active',
	);
	assert.equal(
		getForegroundServiceNotificationMessage({
			hasConnection: false,
			isAutoConnecting: false,
			isReconnecting: true,
		}),
		'Reconnecting...',
	);
});

void test('agent notification bridge runs while the Android app is active', () => {
	assert.equal(
		canRunAgentNotificationBridge({
			platformOS: 'android',
			appActive: true,
			foregroundServiceStarted: false,
		}),
		true,
	);
});

void test('agent notification bridge requires foreground service coverage in Android background', () => {
	assert.equal(
		canRunAgentNotificationBridge({
			platformOS: 'android',
			appActive: false,
			foregroundServiceStarted: false,
		}),
		false,
	);
	assert.equal(
		canRunAgentNotificationBridge({
			platformOS: 'android',
			appActive: false,
			foregroundServiceStarted: true,
		}),
		true,
	);
});

void test('Android background work is allowed only after foreground service start succeeds', () => {
	assert.equal(
		canRunAndroidBackgroundWork({
			platformOS: 'android',
			foregroundServiceStarted: false,
		}),
		false,
	);
	assert.equal(
		canRunAndroidBackgroundWork({
			platformOS: 'android',
			foregroundServiceStarted: true,
		}),
		true,
	);
	assert.equal(
		canRunAndroidBackgroundWork({
			platformOS: 'ios',
			foregroundServiceStarted: true,
		}),
		false,
	);
});

void test('foreground service keeps running while reconnecting without shells', () => {
	assert.equal(
		shouldRunForegroundService({
			shellCount: 0,
			isAutoConnecting: false,
			isReconnecting: true,
		}),
		true,
	);
	assert.equal(
		shouldRunForegroundService({
			shellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
});

void test('background shell drop preserves foreground service until reconnect scheduling runs', () => {
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: true,
			previousShellCount: 1,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		true,
	);
});

void test('foreground service is not preserved for unsupported shell drops', () => {
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
			previousShellCount: 1,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'ios',
			appActive: false,
			backgroundWorkAllowed: true,
			previousShellCount: 1,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
	assert.equal(
		shouldPreserveForegroundServiceForShellDrop({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: true,
			previousShellCount: 0,
			nextShellCount: 0,
			isAutoConnecting: false,
			isReconnecting: false,
		}),
		false,
	);
});

void test('background transition keeps reconnect running when Android background work is allowed', () => {
	assert.equal(
		shouldStopReconnectOnBackground({
			platformOS: 'android',
			backgroundWorkAllowed: true,
		}),
		false,
	);
});

void test('background transition stops reconnect without Android background work', () => {
	assert.equal(
		shouldStopReconnectOnBackground({
			platformOS: 'android',
			backgroundWorkAllowed: false,
		}),
		true,
	);
	assert.equal(
		shouldStopReconnectOnBackground({
			platformOS: 'ios',
			backgroundWorkAllowed: true,
		}),
		true,
	);
});

void test('background reconnect waits for foreground service coverage to restart', () => {
	assert.equal(
		shouldWaitForForegroundServiceCoverage({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: true,
		}),
		true,
	);
	assert.equal(
		shouldWaitForForegroundServiceCoverage({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: false,
		}),
		false,
	);
	assert.equal(
		shouldWaitForForegroundServiceCoverage({
			platformOS: 'android',
			appActive: true,
			backgroundWorkAllowed: false,
			foregroundServiceRequired: true,
		}),
		false,
	);
});

void test('scheduled background reconnect waits instead of attempting while service coverage restarts', () => {
	assert.equal(
		canAttemptBackgroundReconnect({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: false,
		}),
		false,
	);
	assert.equal(
		canAttemptBackgroundReconnect({
			platformOS: 'android',
			appActive: true,
			backgroundWorkAllowed: false,
		}),
		true,
	);
	assert.equal(
		canAttemptBackgroundReconnect({
			platformOS: 'android',
			appActive: false,
			backgroundWorkAllowed: true,
		}),
		true,
	);
});

void test('foreground service start coordinator keeps same-key pending results current', () => {
	const coordinator = createForegroundServiceStartCoordinator();
	const request = coordinator.begin('Fressh Terminal|Connected');

	assert.equal(
		coordinator.isCurrent(request, 'Fressh Terminal|Connected'),
		true,
	);
	assert.equal(
		coordinator.isCurrent(request, 'Fressh Terminal|Reconnecting'),
		false,
	);
});

void test('foreground service start coordinator invalidates stale starts on stop or replacement', () => {
	const coordinator = createForegroundServiceStartCoordinator();
	const first = coordinator.begin('Fressh Terminal|Connected');
	const second = coordinator.begin('Fressh Terminal|Reconnecting');

	assert.equal(
		coordinator.isCurrent(first, 'Fressh Terminal|Connected'),
		false,
	);
	assert.equal(
		coordinator.isCurrent(second, 'Fressh Terminal|Reconnecting'),
		true,
	);

	coordinator.invalidate();

	assert.equal(
		coordinator.isCurrent(second, 'Fressh Terminal|Reconnecting'),
		false,
	);
});

void test('foreground service start retry delay is bounded while service is still needed', () => {
	assert.equal(
		getForegroundServiceStartRetryDelay({
			shouldRunService: false,
			failedAttempts: 0,
		}),
		null,
	);
	assert.equal(
		getForegroundServiceStartRetryDelay({
			shouldRunService: true,
			failedAttempts: 0,
			retryDelayMs: 123,
		}),
		123,
	);
	assert.equal(
		getForegroundServiceStartRetryDelay({
			shouldRunService: true,
			failedAttempts: 5,
			maxAttempts: 5,
		}),
		null,
	);
});

void test('runtime bridge pause does not clear pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: false,
			hasConfiguredTarget: true,
		}),
		false,
	);
});

void test('missing configured target clears pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: false,
			hasConfiguredTarget: false,
		}),
		true,
	);
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: true,
			hasConfiguredTarget: true,
		}),
		false,
	);
});

void test('missing configured target preserves pending agent notifications while reconnect is expected', () => {
	assert.equal(
		shouldClearPendingAgentNotifications({
			hasListenerTarget: false,
			hasConfiguredTarget: false,
			reconnectExpected: true,
		}),
		false,
	);
});

void test('missing configured target preserves pending agent notifications during reconnect', () => {
	assert.equal(
		shouldPreservePendingWithoutTarget({
			previousShellCount: 0,
			shellCount: 0,
			appActive: false,
			androidBackgroundWorkAllowed: true,
			isReconnecting: true,
		}),
		true,
	);
	assert.equal(
		shouldPreservePendingWithoutTarget({
			previousShellCount: 0,
			shellCount: 0,
			appActive: false,
			androidBackgroundWorkAllowed: false,
			isReconnecting: true,
		}),
		false,
	);
});

void test('missing configured target preserves pending agent notifications while shell settings load', () => {
	assert.equal(
		shouldPreservePendingWithoutConfiguredTarget({
			reconnectExpected: false,
			hasShell: true,
			hasConnection: true,
			settingsLoaded: false,
		}),
		true,
	);
	assert.equal(
		shouldPreservePendingWithoutConfiguredTarget({
			reconnectExpected: false,
			hasShell: true,
			hasConnection: true,
			settingsLoaded: true,
		}),
		false,
	);
	assert.equal(
		shouldPreservePendingWithoutConfiguredTarget({
			reconnectExpected: true,
			hasShell: false,
			hasConnection: false,
			settingsLoaded: false,
		}),
		true,
	);
});

void test('shell-only listener target changes do not clear pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: 'conn-1:main',
		}),
		false,
	);
});

void test('resume target changes clear pending agent notifications', () => {
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: 'conn-2:main',
		}),
		true,
	);
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: null,
		}),
		true,
	);
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: null,
			nextResumeKey: 'conn-1:main',
		}),
		false,
	);
});

void test('transient missing resume target does not clear pending agent notifications while reconnect is expected', () => {
	assert.equal(
		shouldClearPendingAgentNotificationsForResumeKeyChange({
			previousResumeKey: 'conn-1:main',
			nextResumeKey: null,
			reconnectExpected: true,
		}),
		false,
	);
});

void test('transient reconnect keeps the last non-null resume key for the next comparison', () => {
	assert.equal(
		getNextConfiguredResumeKey({
			previousResumeKey: 'saved-host:main',
			nextResumeKey: null,
			reconnectExpected: true,
		}),
		'saved-host:main',
	);
	assert.equal(
		getNextConfiguredResumeKey({
			previousResumeKey: 'saved-host:main',
			nextResumeKey: 'other-host:main',
			reconnectExpected: true,
		}),
		'other-host:main',
	);
	assert.equal(
		getNextConfiguredResumeKey({
			previousResumeKey: 'saved-host:main',
			nextResumeKey: null,
			reconnectExpected: false,
		}),
		null,
	);
});

void test('agent notification restart coordinator exhausts delays and resets after healthy work', () => {
	const coordinator = createAgentNotificationRestartCoordinator({
		maxAttempts: 2,
		delaysMs: [100, 200],
		healthyResetMs: 1_000,
	});

	assert.equal(coordinator.attempts, 0);
	assert.deepEqual(coordinator.consume(), { attempt: 0, delayMs: 100 });
	assert.equal(coordinator.attempts, 1);
	assert.deepEqual(coordinator.consume(), { attempt: 1, delayMs: 200 });
	assert.equal(coordinator.attempts, 2);
	assert.equal(coordinator.consume(), null);
	assert.equal(coordinator.attempts, 2);

	assert.equal(
		coordinator.resetIfHealthy({ nowMs: 1_500, startedAtMs: 1_000 }),
		false,
	);
	assert.equal(coordinator.attempts, 2);
	assert.equal(
		coordinator.resetIfHealthy({ nowMs: 2_000, startedAtMs: 1_000 }),
		true,
	);

	assert.equal(coordinator.attempts, 0);
	assert.deepEqual(coordinator.consume(), { attempt: 0, delayMs: 100 });
});

void test('agent notification restart coordinator reuses the last delay after the delay list is exhausted', () => {
	const coordinator = createAgentNotificationRestartCoordinator({
		maxAttempts: 4,
		delaysMs: [100, 200],
	});

	assert.deepEqual(coordinator.consume(), { attempt: 0, delayMs: 100 });
	assert.deepEqual(coordinator.consume(), { attempt: 1, delayMs: 200 });
	assert.deepEqual(coordinator.consume(), { attempt: 2, delayMs: 200 });
	assert.deepEqual(coordinator.consume(), { attempt: 3, delayMs: 200 });
	assert.equal(coordinator.consume(), null);
});

void test('agent notification restart delay schedules a probe after budget exhaustion', () => {
	assert.deepEqual(
		getAgentNotificationRestartDelay({
			restart: { delayMs: 2_000 },
		}),
		{ delayMs: 2_000, exhausted: false },
	);
	assert.deepEqual(
		getAgentNotificationRestartDelay({
			restart: null,
		}),
		{
			delayMs: AGENT_NOTIFICATION_RESTART_EXHAUSTED_PROBE_MS,
			exhausted: true,
		},
	);
	assert.deepEqual(
		getAgentNotificationRestartDelay({
			restart: null,
			exhaustedProbeMs: 123,
		}),
		{ delayMs: 123, exhausted: true },
	);
});

void test('agent notification post retry coordinator tracks attempts per event key', () => {
	const coordinator = createAgentNotificationPostRetryCoordinator({
		maxAttempts: 3,
		delaysMs: [100, 500],
	});

	assert.deepEqual(coordinator.consume('conn:main:@12:waiting'), {
		attempt: 0,
		delayMs: 100,
	});
	assert.deepEqual(coordinator.consume('conn:main:@13:waiting'), {
		attempt: 0,
		delayMs: 100,
	});
	assert.deepEqual(coordinator.consume('conn:main:@12:waiting'), {
		attempt: 1,
		delayMs: 500,
	});
	assert.deepEqual(coordinator.consume('conn:main:@12:waiting'), {
		attempt: 2,
		delayMs: 500,
	});
	assert.equal(coordinator.consume('conn:main:@12:waiting'), null);
	assert.equal(coordinator.getAttemptCount('conn:main:@12:waiting'), 3);
	assert.equal(coordinator.getAttemptCount('conn:main:@13:waiting'), 1);
});

void test('agent notification post retry key is stable per pending key and event id', () => {
	const key = JSON.stringify(['saved-host', 'main', '@12']);

	assert.equal(
		createAgentNotificationPostRetryKey({
			key,
			eventId: 'main:@12:2000:waiting',
		}),
		createAgentNotificationPostRetryKey({
			key,
			eventId: 'main:@12:2000:waiting',
		}),
	);
	assert.notEqual(
		createAgentNotificationPostRetryKey({
			key,
			eventId: 'main:@12:2000:waiting',
		}),
		createAgentNotificationPostRetryKey({
			key,
			eventId: 'main:@12:3000:done',
		}),
	);
	assert.notEqual(
		createAgentNotificationPostRetryKey({
			key,
			eventId: 'main:@12:2000:waiting',
		}),
		createAgentNotificationPostRetryKey({
			key: JSON.stringify(['saved-host', 'main', '@13']),
			eventId: 'main:@12:2000:waiting',
		}),
	);
});

void test('agent notification post retry coordinator clears finished and reset retries', () => {
	const coordinator = createAgentNotificationPostRetryCoordinator({
		maxAttempts: 2,
		delaysMs: [100],
	});

	assert.deepEqual(coordinator.consume('event-a'), {
		attempt: 0,
		delayMs: 100,
	});
	assert.deepEqual(coordinator.consume('event-b'), {
		attempt: 0,
		delayMs: 100,
	});
	coordinator.clear('event-a');
	assert.deepEqual(coordinator.consume('event-a'), {
		attempt: 0,
		delayMs: 100,
	});
	coordinator.clearAll();
	assert.equal(coordinator.getAttemptCount('event-a'), 0);
	assert.equal(coordinator.getAttemptCount('event-b'), 0);
});

void test('agent notification cursor advance callback records only successful reposts', () => {
	const recordedEventIds: string[] = [];
	const lastSeenByTarget = new Map<string, string>();
	const onPosted = createAgentNotificationCursorAdvanceOnPost({
		resumeKey: 'saved-host:main',
		eventId: 'main:@12:2000:done',
		recordEventId: (eventId) => recordedEventIds.push(eventId),
		setLastSeenId: (resumeKey, eventId) => {
			lastSeenByTarget.set(resumeKey, eventId);
		},
	});

	assert.equal(typeof onPosted, 'function');
	onPosted?.(false);
	assert.deepEqual(recordedEventIds, []);
	assert.deepEqual(Array.from(lastSeenByTarget.entries()), []);

	onPosted?.(true);
	assert.deepEqual(recordedEventIds, ['main:@12:2000:done']);
	assert.deepEqual(Array.from(lastSeenByTarget.entries()), [
		['saved-host:main', 'main:@12:2000:done'],
	]);
	assert.equal(
		createAgentNotificationCursorAdvanceOnPost({
			resumeKey: null,
			eventId: 'main:@12:2000:done',
			recordEventId: () => {},
			setLastSeenId: () => {},
		}),
		undefined,
	);
});

void test('agent notification cursor advance callback uses pending resume key', () => {
	const lastSeenByTarget = new Map<string, string>();
	const onPosted = createAgentNotificationCursorAdvanceOnPost({
		resumeKey: 'saved-host:main',
		eventId: 'main:@12:2000:done',
		recordEventId: () => {},
		setLastSeenId: (resumeKey, eventId) => {
			lastSeenByTarget.set(resumeKey, eventId);
		},
	});

	onPosted(true);

	assert.deepEqual(Array.from(lastSeenByTarget.entries()), [
		['saved-host:main', 'main:@12:2000:done'],
	]);
	assert.equal(lastSeenByTarget.has('other-host:main'), false);
});

void test('agent notification repost input uses pending resume key', () => {
	const recordedEventIds: string[] = [];
	const lastSeenByTarget = new Map<string, string>();
	const repostInput = createAgentNotificationRepostInput({
		current: {
			key: JSON.stringify(['saved-host', 'main', '@12']),
			notificationId: 42,
			resumeKey: 'saved-host:main',
			event: {
				id: 'main:@12:2000:done',
				type: 'tmux_status',
				session: 'main',
				target: 'saved-host',
				windowId: '@12',
				windowIndex: '1',
				windowName: 'agent',
				status: 'done',
				icon: '✅',
				createdAtMs: 2_000,
			},
		},
		target: {
			key: 'other-host:main',
			connectionId: 'connection-record-id',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		recordEventId: (eventId) => recordedEventIds.push(eventId),
		setLastSeenId: (resumeKey, eventId) => {
			lastSeenByTarget.set(resumeKey, eventId);
		},
	});

	assert.equal(repostInput?.targetKey, 'other-host:main');
	assert.equal(repostInput?.connectionId, 'connection-record-id');
	assert.equal(repostInput?.key, JSON.stringify(['saved-host', 'main', '@12']));
	assert.equal(repostInput?.notificationId, 42);
	assert.deepEqual(repostInput?.event, {
		id: 'main:@12:2000:done',
		type: 'tmux_status',
		session: 'main',
		target: 'saved-host',
		windowId: '@12',
		windowIndex: '1',
		windowName: 'agent',
		status: 'done',
		icon: '✅',
		createdAtMs: 2_000,
	});
	assert.equal(repostInput?.channelId, 7);
	assert.equal(repostInput?.notificationConnectionId, 'saved-host');
	repostInput?.onPosted?.(true);

	assert.deepEqual(recordedEventIds, ['main:@12:2000:done']);
	assert.deepEqual(Array.from(lastSeenByTarget.entries()), [
		['saved-host:main', 'main:@12:2000:done'],
	]);
	assert.equal(lastSeenByTarget.has('other-host:main'), false);
});

void test('agent notification repost input rejects mismatched current target', () => {
	const repostInput = createAgentNotificationRepostInput({
		current: {
			key: JSON.stringify(['saved-host', 'main', '@12']),
			notificationId: 42,
			resumeKey: 'saved-host:main',
			event: {
				id: 'main:@12:2000:done',
				type: 'tmux_status',
				session: 'main',
				target: 'saved-host',
				windowId: '@12',
				windowIndex: '1',
				windowName: 'agent',
				status: 'done',
				icon: '✅',
				createdAtMs: 2_000,
			},
		},
		target: {
			key: 'other-host:main',
			connectionId: 'connection-record-id',
			channelId: 7,
			notificationConnectionId: 'other-host',
		},
		recordEventId: () => {},
		setLastSeenId: () => {},
	});

	assert.equal(repostInput, null);
});

void test('agent notification post retry repost input rejects stale events', () => {
	const repostInput = createAgentNotificationPostRetryRepostInput({
		eventId: 'main:@12:2000:waiting',
		current: {
			key: JSON.stringify(['saved-host', 'main', '@12']),
			notificationId: 42,
			resumeKey: 'saved-host:main',
			event: {
				id: 'main:@12:3000:done',
				type: 'tmux_status',
				session: 'main',
				target: 'saved-host',
				windowId: '@12',
				windowIndex: '1',
				windowName: 'agent',
				status: 'done',
				icon: '✅',
				createdAtMs: 3_000,
			},
		},
		target: {
			key: 'saved-host:main',
			connectionId: 'connection-record-id',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		recordEventId: () => {},
		setLastSeenId: () => {},
	});

	assert.equal(repostInput, null);
});

void test('agent notification post retry repost input ignores cleared pending events', () => {
	const repostInput = createAgentNotificationPostRetryRepostInput({
		eventId: 'main:@12:2000:waiting',
		current: null,
		target: {
			key: 'saved-host:main',
			connectionId: 'connection-record-id',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		recordEventId: () => {},
		setLastSeenId: () => {},
	});

	assert.equal(repostInput, null);
});

void test('agent notification post retry repost input returns current repost', () => {
	const lastSeenByTarget = new Map<string, string>();
	const repostInput = createAgentNotificationPostRetryRepostInput({
		eventId: 'main:@12:2000:waiting',
		current: {
			key: JSON.stringify(['saved-host', 'main', '@12']),
			notificationId: 42,
			resumeKey: 'saved-host:main',
			event: {
				id: 'main:@12:2000:waiting',
				type: 'tmux_status',
				session: 'main',
				target: 'saved-host',
				windowId: '@12',
				windowIndex: '1',
				windowName: 'agent',
				status: 'waiting',
				icon: '💬',
				createdAtMs: 2_000,
			},
		},
		target: {
			key: 'saved-host:main',
			connectionId: 'connection-record-id',
			channelId: 7,
			notificationConnectionId: 'saved-host',
		},
		recordEventId: () => {},
		setLastSeenId: (resumeKey, eventId) => {
			lastSeenByTarget.set(resumeKey, eventId);
		},
	});

	assert.equal(repostInput?.notificationId, 42);
	repostInput?.onPosted?.(true);
	assert.deepEqual(Array.from(lastSeenByTarget.entries()), [
		['saved-host:main', 'main:@12:2000:waiting'],
	]);
});
