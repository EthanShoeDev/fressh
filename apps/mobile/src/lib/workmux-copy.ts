export function getWorkmuxAttachErrorCopy(sessionName: string): {
	body: string;
	title: string;
};
export function getWorkmuxAttachErrorCopy(
	sessionName: string,
	failureReason: string | null | undefined,
): {
	body: string;
	title: string;
};
export function getWorkmuxAttachErrorCopy(
	sessionName: string,
	failureReason?: string | null,
): {
	body: string;
	title: string;
} {
	const trimmedReason = failureReason?.trim();
	return {
		title: trimmedReason ? 'Workmux attach failed' : 'Workmux session not found',
		body: trimmedReason
			? `We could not attach to Workmux session "${sessionName}". Remote error: ${trimmedReason}`
			: `We could not attach to Workmux session "${sessionName}". Create it on the server and try again.`,
	};
}
