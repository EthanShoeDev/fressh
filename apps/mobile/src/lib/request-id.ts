import { useCallback, useRef } from 'react';

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
	return { next, isCurrent, invalidate };
}
