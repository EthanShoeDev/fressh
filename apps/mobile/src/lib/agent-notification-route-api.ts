import { acknowledgeAgentNotification } from './agent-notification-bridge-api';
import {
	acknowledgeRoutedAgentNotificationWithDependencies,
} from './agent-notification-route-api-core';
import {
	type AgentNotificationRouteIdentity,
	type AgentNotificationRouteToken,
} from './agent-notification-route-identity';
import {
	clearStoredAgentNotificationRouteTokens,
	consumeStoredAgentNotificationRouteToken,
	createStoredAgentNotificationRouteToken,
	deleteStoredAgentNotificationRouteTokens,
	deleteStoredAgentNotificationRouteToken,
	hasStoredAgentNotificationRouteToken,
	restoreStoredAgentNotificationRouteToken,
} from './agent-notification-route-store';
import { cancelAgentAlertNotification } from './agent-notifications-native';
import { rootLogger } from './logger';

const logger = rootLogger.extend('AgentNotificationRoute');

export function createRoutedAgentNotificationRouteToken(
	input: AgentNotificationRouteIdentity,
) {
	return createStoredAgentNotificationRouteToken(input);
}

export function hasAuthorizedAgentNotificationRouteToken(
	connectionId: string,
	session: string,
	windowId: string,
	eventId: string,
	tapToken: string,
) {
	try {
		return hasStoredAgentNotificationRouteToken({
			connectionId,
			session,
			windowId,
			eventId,
			tapToken,
		});
	} catch (error) {
		logger.warn('agent notification route token lookup failed', error);
		return false;
	}
}

export function consumeAuthorizedAgentNotificationRouteToken(
	connectionId: string,
	session: string,
	windowId: string,
	eventId: string,
	tapToken: string,
) {
	try {
		return consumeStoredAgentNotificationRouteToken({
			connectionId,
			session,
			windowId,
			eventId,
			tapToken,
		});
	} catch (error) {
		logger.warn('agent notification route token consume failed', error);
		return false;
	}
}

export function restoreAuthorizedAgentNotificationRouteToken(
	connectionId: string,
	session: string,
	windowId: string,
	eventId: string,
	tapToken: string,
) {
	try {
		return restoreStoredAgentNotificationRouteToken({
			connectionId,
			session,
			windowId,
			eventId,
			tapToken,
		});
	} catch (error) {
		logger.warn('agent notification route token restore failed', error);
		return false;
	}
}

export function deleteRoutedAgentNotificationRouteToken(
	input: AgentNotificationRouteToken,
) {
	deleteStoredAgentNotificationRouteToken(input);
}

export function clearRoutedAgentNotificationRouteTokens() {
	clearStoredAgentNotificationRouteTokens();
}

export function acknowledgeRoutedAgentNotification(
	connectionId: string,
	session: string,
	windowId: string,
) {
	acknowledgeRoutedAgentNotificationWithDependencies(
		{
			deleteRouteTokens: deleteStoredAgentNotificationRouteTokens,
			acknowledgeBridge: acknowledgeAgentNotification,
			cancelNotification: (notificationId) => {
				void cancelAgentAlertNotification(notificationId);
			},
			warn: (message, error) => logger.warn(message, error),
		},
		{ connectionId, session, windowId },
	);
}
