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
