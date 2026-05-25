import * as Crypto from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';
import {
	type AgentNotificationRouteIdentity,
	type AgentNotificationRouteToken,
} from './agent-notification-route-identity';
import { createAgentNotificationRouteTokenStore } from './agent-notification-route-store-core';

const store = createAgentNotificationRouteTokenStore({
	storage: new MMKV({ id: 'agent-notification-routes' }),
	createToken: () => Crypto.randomUUID(),
});

export function createStoredAgentNotificationRouteToken(
	input: AgentNotificationRouteIdentity,
) {
	return store.create(input);
}

export function hasStoredAgentNotificationRouteToken(
	input: AgentNotificationRouteToken,
) {
	return store.has(input);
}

export function consumeStoredAgentNotificationRouteToken(
	input: AgentNotificationRouteToken,
) {
	return store.consume(input);
}

export function restoreStoredAgentNotificationRouteToken(
	input: AgentNotificationRouteToken,
) {
	return store.restore(input);
}

export function deleteStoredAgentNotificationRouteToken(
	input: AgentNotificationRouteIdentity & { tapToken?: string },
) {
	store.delete(input);
}

export function deleteStoredAgentNotificationRouteTokens(input: {
	connectionId: string;
	session: string;
	windowId: string;
}) {
	store.deleteMatching(input);
}

export function clearStoredAgentNotificationRouteTokens() {
	store.clear();
}
