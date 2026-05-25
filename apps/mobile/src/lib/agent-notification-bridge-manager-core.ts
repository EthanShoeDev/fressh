import {
	type AgentNotificationEvent,
	matchesAgentNotificationPendingKey,
} from './agent-notification-events';
import { createAgentNotificationCursorAdvanceOnPost } from './agent-notification-runtime';

export const AGENT_NOTIFICATION_RESTART_EXHAUSTED_PROBE_MS =
	5 * 60 * 1000;

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
