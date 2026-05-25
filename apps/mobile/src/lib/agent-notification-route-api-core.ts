import {
	createAgentNotificationPendingKey,
	createStableNotificationId,
} from './agent-notification-events';

type RoutedAgentNotificationAcknowledgeDependencies = {
	deleteRouteTokens: (input: {
		connectionId: string;
		session: string;
		windowId: string;
	}) => void;
	acknowledgeBridge: (
		connectionId: string,
		session: string,
		windowId: string,
	) => number[];
	cancelNotification: (notificationId: number) => void;
	warn: (message: string, error: unknown) => void;
};

export function acknowledgeRoutedAgentNotificationWithDependencies(
	dependencies: RoutedAgentNotificationAcknowledgeDependencies,
	input: { connectionId: string; session: string; windowId: string },
) {
	try {
		dependencies.deleteRouteTokens(input);
	} catch (error) {
		dependencies.warn('agent notification route token cleanup failed', error);
	}
	const notificationIds = dependencies.acknowledgeBridge(
		input.connectionId,
		input.session,
		input.windowId,
	);
	for (const notificationId of notificationIds) {
		dependencies.cancelNotification(notificationId);
	}
	if (notificationIds.length === 0) {
		dependencies.cancelNotification(
			createRoutedAgentNotificationId(
				input.connectionId,
				input.session,
				input.windowId,
			),
		);
	}
}

export function createRoutedAgentNotificationId(
	connectionId: string,
	session: string,
	windowId: string,
) {
	return createStableNotificationId(
		createAgentNotificationPendingKey({ connectionId, session, windowId }),
	);
}
