export function getWorkmuxAttachErrorCopy(sessionName: string): {
	body: string;
	title: string;
} {
	return {
		title: 'Workmux session not found',
		body: `We could not attach to Workmux session "${sessionName}". Create it on the server and try again.`,
	};
}
