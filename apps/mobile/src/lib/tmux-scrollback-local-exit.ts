export const TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT = 100;

export function registerTmuxScrollbackLocalExitRequest({
	requestIds,
	requestId,
}: {
	requestIds: Set<number>;
	requestId: number;
}) {
	while (requestIds.size >= TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT) {
		const oldestRequestId = requestIds.values().next().value;
		if (oldestRequestId === undefined) break;
		requestIds.delete(oldestRequestId);
	}
	requestIds.add(requestId);
}

export function createTmuxScrollbackLocalExitRequest({
	requestIds,
	requestId,
	instanceId,
}: {
	requestIds: Set<number>;
	requestId: number;
	instanceId: string | null;
}): { message: { requestId: number; instanceId?: string } } {
	registerTmuxScrollbackLocalExitRequest({ requestIds, requestId });
	return {
		message:
			instanceId == null
				? { requestId }
				: {
						requestId,
						instanceId,
					},
	};
}

export function resetTmuxScrollbackLocalExitRequests(requestIds: Set<number>) {
	requestIds.clear();
}
