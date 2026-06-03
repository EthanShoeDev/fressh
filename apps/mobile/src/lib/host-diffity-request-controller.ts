import { type RequestIdHandle } from './request-id';

export type HostDiffityRequestController = {
	start: () => number | null;
	finish: (id: number) => void;
	invalidate: () => void;
	isCurrent: (id: number) => boolean;
};

export function createHostDiffityRequestController({
	requestId,
	inFlightRef,
}: {
	requestId: RequestIdHandle;
	inFlightRef: { current: boolean };
}): HostDiffityRequestController {
	return {
		start: () => {
			if (inFlightRef.current) return null;
			const id = requestId.next();
			inFlightRef.current = true;
			return id;
		},
		finish: (id) => {
			if (!requestId.isCurrent(id)) return;
			inFlightRef.current = false;
		},
		invalidate: () => {
			requestId.invalidate();
			inFlightRef.current = false;
		},
		isCurrent: (id) => requestId.isCurrent(id),
	};
}
