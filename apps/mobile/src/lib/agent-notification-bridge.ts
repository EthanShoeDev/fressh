import {
	type AgentNotificationDedupe,
	type AgentNotificationEvent,
	handleAgentNotificationEvent,
	matchesAgentNotificationPendingKey,
	parseAgentNotificationLine,
} from './agent-notification-events';
import { createAgentNotificationCursorAdvanceOnPost } from './foreground-service-runtime';

export const HEARTBEAT_STALE_MS = 75_000;

export const AGENT_NOTIFICATION_RESTART_EXHAUSTED_PROBE_MS = 5 * 60 * 1000;

export type AgentNotificationBridgeStatus =
	| 'inactive'
	| 'starting'
	| 'active'
	| 'degraded'
	| 'stopped-by-os-or-connection';

export type AgentNotificationBridgeState = {
	status: AgentNotificationBridgeStatus;
	lastHeartbeatAtMs: number | null;
	lastSeenId: string | null;
};

export class AgentNotificationBridgeStateMachine {
	private currentState: AgentNotificationBridgeState = {
		status: 'inactive',
		lastHeartbeatAtMs: null,
		lastSeenId: null,
	};

	get state(): AgentNotificationBridgeState {
		return { ...this.currentState };
	}

	markStarting(): void {
		this.currentState = {
			...this.currentState,
			status: 'starting',
		};
	}

	recordHeartbeat(nowMs: number): void {
		this.currentState = {
			...this.currentState,
			status: 'active',
			lastHeartbeatAtMs: nowMs,
		};
	}

	recordEventId(id: string): void {
		this.currentState = {
			...this.currentState,
			lastSeenId: id,
		};
	}

	checkHeartbeat(nowMs: number): void {
		const { lastHeartbeatAtMs, status } = this.currentState;
		if (status !== 'active' && status !== 'degraded') return;
		if (lastHeartbeatAtMs === null) return;
		if (nowMs - lastHeartbeatAtMs < HEARTBEAT_STALE_MS) return;
		this.markDegraded();
	}

	markDegraded(): void {
		this.currentState = {
			...this.currentState,
			status: 'degraded',
		};
	}

	markInactive(): void {
		this.currentState = {
			...this.currentState,
			status: 'inactive',
		};
	}

	markStoppedByOsOrConnection(): void {
		this.currentState = {
			...this.currentState,
			status: 'stopped-by-os-or-connection',
		};
	}
}

export type AgentNotificationBridgeApi = {
	acknowledge: (
		connectionId: string,
		session: string,
		windowId: string,
	) => number[];
};

let currentBridgeApi: AgentNotificationBridgeApi | null = null;

export function setAgentNotificationBridgeApi(api: AgentNotificationBridgeApi) {
	currentBridgeApi = api;
	return () => {
		if (currentBridgeApi === api) {
			currentBridgeApi = null;
		}
	};
}

export function acknowledgeAgentNotification(
	connectionId: string,
	session: string,
	windowId: string,
) {
	return currentBridgeApi?.acknowledge(connectionId, session, windowId) ?? [];
}

export function getAgentNotificationRestartDelay(input: {
	restart: { delayMs: number } | null;
	exhaustedProbeMs?: number;
}) {
	return {
		delayMs:
			input.restart?.delayMs ??
			input.exhaustedProbeMs ??
			AGENT_NOTIFICATION_RESTART_EXHAUSTED_PROBE_MS,
		exhausted: input.restart === null,
	};
}

export function createAgentNotificationPostRetryKey(input: {
	key: string;
	eventId: string;
}) {
	return JSON.stringify([input.key, input.eventId]);
}

type AgentNotificationPendingRepost = {
	key: string;
	notificationId: number;
	event: AgentNotificationEvent;
	resumeKey: string | null;
};

type AgentNotificationRepostTarget = {
	key: string;
	connectionId: string;
	channelId: number;
	notificationConnectionId: string;
};

export function createAgentNotificationRepostInput(input: {
	current: AgentNotificationPendingRepost;
	target: AgentNotificationRepostTarget;
	recordEventId: (eventId: string) => void;
	setLastSeenId: (resumeKey: string, eventId: string) => void;
}) {
	const { current, target } = input;
	if (
		!matchesAgentNotificationPendingKey(current.key, {
			connectionId: target.notificationConnectionId,
			session: current.event.session,
			windowId: current.event.windowId,
		})
	) {
		return null;
	}
	return {
		...current,
		targetKey: target.key,
		connectionId: target.connectionId,
		channelId: target.channelId,
		notificationConnectionId: target.notificationConnectionId,
		onPosted: createAgentNotificationCursorAdvanceOnPost({
			resumeKey: current.resumeKey,
			eventId: current.event.id,
			recordEventId: input.recordEventId,
			setLastSeenId: input.setLastSeenId,
		}),
	};
}

export function createAgentNotificationPostRetryRepostInput(input: {
	current: AgentNotificationPendingRepost | null;
	eventId: string;
	target: AgentNotificationRepostTarget;
	recordEventId: (eventId: string) => void;
	setLastSeenId: (resumeKey: string, eventId: string) => void;
}) {
	if (!input.current || input.current.event.id !== input.eventId) return null;
	return createAgentNotificationRepostInput({
		current: input.current,
		target: input.target,
		recordEventId: input.recordEventId,
		setLastSeenId: input.setLastSeenId,
	});
}

export type AgentNotificationRuntimeTarget = {
	key: string;
	resumeKey: string;
	connectionId: string;
	channelId: number;
	notificationConnectionId: string;
};

export type AgentNotificationListenerLineInput = {
	line: string;
	activeTarget: AgentNotificationRuntimeTarget;
	currentTargetKey: string | null;
	nowMs: number;
	bridge: AgentNotificationBridgeStateMachine;
	lastSeenIdByTarget: Map<string, string>;
	dedupe: AgentNotificationDedupe;
	notifyPending: () => void;
	onHeartbeat?: () => void;
	postPendingNotification: (input: {
		key: string;
		notificationId: number;
		event: AgentNotificationEvent;
		targetKey: string;
		connectionId: string;
		channelId: number;
		notificationConnectionId: string;
		onPosted: (posted: boolean) => void;
	}) => void;
	warn: (message: string, context: unknown) => void;
};

export function handleAgentNotificationListenerLine({
	line,
	activeTarget,
	currentTargetKey,
	nowMs,
	bridge,
	lastSeenIdByTarget,
	dedupe,
	notifyPending,
	onHeartbeat,
	postPendingNotification,
	warn,
}: AgentNotificationListenerLineInput) {
	if (currentTargetKey !== activeTarget.key) return;

	const parsed = parseAgentNotificationLine(line);
	if (!parsed) {
		warn('ignored malformed agent notification line', { line });
		return;
	}

	if (parsed.type === 'heartbeat') {
		bridge.recordHeartbeat(nowMs);
		onHeartbeat?.();
		return;
	}

	handleAgentNotificationEvent({
		event: parsed,
		connectionId: activeTarget.notificationConnectionId,
		dedupe,
		resumeKey: activeTarget.resumeKey,
		notifyPending,
		onPending: ({ key, notificationId, event }) => {
			postPendingNotification({
				key,
				notificationId,
				event,
				targetKey: activeTarget.key,
				connectionId: activeTarget.connectionId,
				channelId: activeTarget.channelId,
				notificationConnectionId: activeTarget.notificationConnectionId,
				onPosted: createAgentNotificationCursorAdvanceOnPost({
					resumeKey: activeTarget.resumeKey,
					eventId: event.id,
					recordEventId: (eventId) => {
						bridge.recordEventId(eventId);
					},
					setLastSeenId: (resumeKey, eventId) => {
						lastSeenIdByTarget.set(resumeKey, eventId);
					},
				}),
			});
		},
	});
}

export function clearAgentNotificationRoutesSafely(input: {
	clearRouteTokens: () => void;
	warn: (message: string, error: unknown) => void;
}) {
	try {
		input.clearRouteTokens();
	} catch (error) {
		input.warn('agent notification route token clear failed', error);
	}
}
