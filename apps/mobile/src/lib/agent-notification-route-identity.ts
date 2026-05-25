export type AgentNotificationRouteIdentity = {
	connectionId: string;
	session: string;
	windowId: string;
	eventId: string;
};

export type AgentNotificationRouteToken = AgentNotificationRouteIdentity & {
	tapToken: string;
};

export function createAgentNotificationRouteIdentityKey(
	input: AgentNotificationRouteIdentity,
) {
	return JSON.stringify([
		input.connectionId,
		input.session,
		input.windowId,
		input.eventId,
	]);
}
