export function runShellScrollbackInactiveCleanup({
	previousState,
	nextState,
	clearScrollbackState,
	warn,
}: {
	previousState: string;
	nextState: string;
	clearScrollbackState: () => Promise<boolean> | null;
	warn: (message: string, error?: unknown) => void;
}): Promise<boolean> | null {
	if (previousState !== 'active' || nextState === 'active') return null;
	let cleanup: Promise<boolean> | null;
	try {
		cleanup = clearScrollbackState();
	} catch (error) {
		warn('Workmux inactive scrollback cleanup failed', error);
		return null;
	}
	void cleanup?.catch((error) => {
		warn('Workmux inactive scrollback cleanup failed', error);
	});
	return cleanup;
}

export function handleShellWorkmuxScrollbackCommandFailureActions({
	message,
	alert,
	copyMessage,
	clearScrollbackState,
	warn,
}: {
	message: string;
	alert: (
		title: string,
		message: string,
		buttons?: { text: string; onPress?: () => void }[],
	) => void;
	copyMessage: (message: string) => void;
	clearScrollbackState: () => void;
	warn: (message: string) => void;
}): void {
	try {
		let warningError: unknown;
		try {
			warn(message);
		} catch (error) {
			warningError = error;
		}
		alert('Workmux scroll unavailable', message, [
			{ text: 'Copy Message', onPress: () => copyMessage(message) },
			{ text: 'OK' },
		]);
		if (warningError) throw warningError;
	} finally {
		clearScrollbackState();
	}
}

export function handleShellWorkmuxScrollbackDisposeExitFailureActions({
	message,
	warn,
}: {
	message: string;
	warn: (message: string) => void;
}): void {
	warn(message);
}
