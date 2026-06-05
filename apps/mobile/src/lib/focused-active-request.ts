export type FocusedActiveState = {
	isFocused: boolean;
	isAppActive: boolean;
};

export function shouldShowFocusedActiveFeedback({
	isFocused,
	isAppActive,
}: FocusedActiveState): boolean {
	return isFocused && isAppActive;
}

export function isFocusedActiveRequestCurrent({
	requestId,
	isCurrentRequest,
	isFocused,
	isAppActive,
}: FocusedActiveState & {
	requestId: number;
	isCurrentRequest: (requestId: number) => boolean;
}): boolean {
	return (
		isCurrentRequest(requestId) &&
		shouldShowFocusedActiveFeedback({ isFocused, isAppActive })
	);
}
