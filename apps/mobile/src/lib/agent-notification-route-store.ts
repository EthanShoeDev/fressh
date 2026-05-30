import * as Crypto from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';
import { acknowledgeAgentNotification } from './agent-notification-bridge';
import { cancelAgentAlertNotification } from './agent-notification-native';
import {
	acknowledgeRoutedAgentNotificationWithDependencies,
	createAgentNotificationRouteTokenStore,
	type AgentNotificationRouteIdentity,
	type AgentNotificationRouteToken,
} from './agent-notification-route';
import { rootLogger } from './logger';

const logger = rootLogger.extend('AgentNotificationRoute');

const store = createAgentNotificationRouteTokenStore({
	storage: new MMKV({ id: 'agent-notification-routes' }),
	createToken: () => Crypto.randomUUID(),
});

export function createRoutedAgentNotificationRouteToken(
	input: AgentNotificationRouteIdentity,
) {
	return store.create(input);
}

export function consumeAuthorizedAgentNotificationRouteToken(
	connectionId: string,
	session: string,
	windowId: string,
	eventId: string,
	tapToken: string,
) {
	try {
		return store.consume({
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
		return store.restore({
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
	store.delete(input);
}

export function clearRoutedAgentNotificationRouteTokens() {
	store.clear();
}

export function acknowledgeRoutedAgentNotification(
	connectionId: string,
	session: string,
	windowId: string,
) {
	acknowledgeRoutedAgentNotificationWithDependencies(
		{
			deleteRouteTokens: (input) => {
				store.deleteMatching(input);
			},
			acknowledgeBridge: acknowledgeAgentNotification,
			cancelNotification: (notificationId) => {
				void cancelAgentAlertNotification(notificationId);
			},
			warn: (message, error) => logger.warn(message, error),
		},
		{ connectionId, session, windowId },
	);
}
