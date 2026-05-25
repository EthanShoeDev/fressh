import {
	type AgentNotificationDedupe,
	type AgentNotificationEvent,
	getAgentAlertNotificationText,
	shouldAdvanceAgentNotificationCursorAfterPost,
} from './agent-notification-events';
import {
	type AgentNotificationRouteIdentity,
	type AgentNotificationRouteToken,
} from './agent-notification-route-identity';
import { type AgentAlertNotificationInput } from './agent-notifications-native';

export const AGENT_NOTIFICATION_POST_TIMEOUT_MS = 10_000;

type AgentNotificationPostingDependencies = {
	createRouteToken: (input: AgentNotificationRouteIdentity) => string;
	deleteRouteToken: (input: AgentNotificationRouteToken) => void;
	postAgentAlertNotification: (
		input: AgentAlertNotificationInput,
	) => Promise<boolean>;
	postTimeoutMs?: number;
	warn?: (message: string, error: unknown) => void;
};

type PostAgentNotificationWithRouteTokenInput = {
	key: string;
	notificationId: number;
	event: AgentNotificationEvent;
	connectionId: string;
	channelId: number;
	notificationConnectionId: string;
	vibrate?: boolean;
	dedupe: AgentNotificationDedupe;
	dependencies: AgentNotificationPostingDependencies;
};

export async function postAgentNotificationWithRouteToken({
	key,
	notificationId,
	event,
	connectionId,
	channelId,
	notificationConnectionId,
	vibrate = true,
	dedupe,
	dependencies,
}: PostAgentNotificationWithRouteTokenInput) {
	const notificationText = getAgentAlertNotificationText(event);
	const attemptId = dedupe.beginPost(key, event.id);
	if (attemptId === null) return null;

	const routeIdentity = {
		connectionId: notificationConnectionId,
		session: event.session,
		windowId: event.windowId,
		eventId: event.id,
	};
	let tapToken: string | null = null;
	let posted = false;
	let timedOut = false;
	try {
		tapToken = dependencies.createRouteToken(routeIdentity);
		posted = await withPostTimeout(
			dependencies.postAgentAlertNotification({
				notificationId,
				title: notificationText.title,
				message: notificationText.message,
				connectionId,
				channelId,
				notificationConnectionId,
				session: event.session,
				target: event.target,
				windowId: event.windowId,
				eventId: event.id,
				tapToken,
				vibrate,
			}),
			dependencies.postTimeoutMs ?? AGENT_NOTIFICATION_POST_TIMEOUT_MS,
		);
	} catch (error) {
		timedOut = isPostTimeoutError(error);
		dependencies.warn?.('agent alert notification post failed', error);
		posted = false;
	}
	const completion = dedupe.completePost(key, event.id, attemptId, posted);

	if (!posted && !timedOut) {
		if (tapToken) {
			try {
				dependencies.deleteRouteToken({ ...routeIdentity, tapToken });
			} catch (error) {
				dependencies.warn?.(
					'agent alert notification route cleanup failed',
					error,
				);
			}
		}
	} else if (posted && tapToken && completion.type === 'cancel-posted') {
		try {
			dependencies.deleteRouteToken({ ...routeIdentity, tapToken });
		} catch (error) {
			dependencies.warn?.(
				'agent alert notification route cleanup failed',
				error,
			);
		}
	}

	const currentPending = dedupe.getPendingEvent(key);
	return {
		completion,
		posted,
		shouldAdvanceCursor: shouldAdvanceAgentNotificationCursorAfterPost({
			posted,
			completion,
			currentEventId: currentPending?.event.id ?? null,
			eventId: event.id,
		}),
	};
}

function withPostTimeout(promise: Promise<boolean>, timeoutMs: number) {
	if (timeoutMs <= 0) return promise;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	return Promise.race([
		promise,
		new Promise<boolean>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error('agent alert notification post timed out'));
			}, timeoutMs);
			const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
				unref?: () => void;
			};
			maybeNodeTimer.unref?.();
		}),
	]).finally(() => {
		if (timeoutId !== null) clearTimeout(timeoutId);
	});
}

function isPostTimeoutError(error: unknown) {
	return (
		error instanceof Error &&
		error.message === 'agent alert notification post timed out'
	);
}
