export class WisprTapTimeoutError extends Error {
	constructor() {
		super('Wispr tap timed out');
		this.name = 'WisprTapTimeoutError';
	}
}

export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			reject(new WisprTapTimeoutError());
		}, timeoutMs);
	});

	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}

export function tapWisprControlWithTimeout({
	tapWisprControl,
	timeoutMs,
	onLateSuccess,
	onLateFailure,
}: {
	tapWisprControl: () => Promise<string>;
	timeoutMs: number;
	onLateSuccess?: () => void;
	onLateFailure?: () => void;
}): Promise<string> {
	let timedOut = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const tapPromise = tapWisprControl();
	tapPromise.then(
		() => {
			if (timedOut) onLateSuccess?.();
		},
		() => {
			if (timedOut) onLateFailure?.();
		},
	);
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			timedOut = true;
			reject(new WisprTapTimeoutError());
		}, timeoutMs);
	});
	return Promise.race([tapPromise, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}
