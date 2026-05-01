type KeyboardDismissScheduler = (callback: () => void) => void;

const scheduleNextFrame: KeyboardDismissScheduler = (callback) => {
	if (typeof globalThis.requestAnimationFrame === 'function') {
		globalThis.requestAnimationFrame(callback);
		return;
	}
	setTimeout(callback, 0);
};

export function closeThenDismissKeyboard({
	close,
	dismissKeyboard,
	schedule = scheduleNextFrame,
}: {
	close: () => void;
	dismissKeyboard: () => void;
	schedule?: KeyboardDismissScheduler;
}) {
	close();
	schedule(dismissKeyboard);
}
