import { useCallback, useMemo, useRef } from 'react';

/**
 * Shared request lifecycle primitive for mobile shell controllers.
 *
 * Call `next()` when async work starts, guard each awaited continuation with
 * `isCurrent(id)`, and call `invalidate()` on blur, AppState inactive,
 * source/target change, modal close, or unmount before clearing visible state.
 * A stale completion may finish its promise, but must not mutate UI, show
 * alerts, clear newer in-flight state, or send follow-up shell commands.
 */
export type RequestIdHandle = {
	next: () => number;
	isCurrent: (id: number) => boolean;
	invalidate: () => void;
};

export function useRequestId(): RequestIdHandle {
	const ref = useRef(0);
	const next = useCallback(() => {
		ref.current += 1;
		return ref.current;
	}, []);
	const isCurrent = useCallback((id: number) => id === ref.current, []);
	const invalidate = useCallback(() => {
		ref.current += 1;
	}, []);
	return useMemo(
		() => ({ next, isCurrent, invalidate }),
		[next, isCurrent, invalidate],
	);
}
