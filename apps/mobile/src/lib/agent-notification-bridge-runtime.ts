import { type AgentNotificationBridgeStateMachine } from './agent-notification-bridge';
import {
	type AgentNotificationEvent,
	handleAgentNotificationEvent,
	parseAgentNotificationLine,
	type AgentNotificationDedupe,
} from './agent-notification-events';
import { createAgentNotificationCursorAdvanceOnPost } from './agent-notification-runtime';

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
