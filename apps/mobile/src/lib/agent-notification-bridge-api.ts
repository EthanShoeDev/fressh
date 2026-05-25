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
