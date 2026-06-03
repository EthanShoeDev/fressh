import { extractLastHttpsUrl } from './host-browser-actions';

export function runHostDiffityOpenRequest({
	hostDiffityInFlightRef,
	hostDiffityRequestId,
	runDiffityShare,
	openAndroidUrl,
	showError,
	getErrorMessage,
}: {
	hostDiffityInFlightRef: { current: boolean };
	hostDiffityRequestId: {
		next: () => number;
		isCurrent: (id: number) => boolean;
	};
	runDiffityShare: () => Promise<string>;
	openAndroidUrl: (url: string) => Promise<void>;
	showError: (title: string, message: string) => void;
	getErrorMessage: (error: unknown) => string;
}): boolean {
	if (hostDiffityInFlightRef.current) return false;
	const id = hostDiffityRequestId.next();
	hostDiffityInFlightRef.current = true;
	void (async () => {
		try {
			const output = await runDiffityShare();
			const url = extractLastHttpsUrl(output);
			if (!url) {
				throw new Error(
					output || 'mdev diffity share did not return an HTTPS URL.',
				);
			}
			if (!hostDiffityRequestId.isCurrent(id)) return;
			await openAndroidUrl(url);
		} catch (err) {
			if (!hostDiffityRequestId.isCurrent(id)) return;
			showError('Diffity failed', getErrorMessage(err));
		} finally {
			if (hostDiffityRequestId.isCurrent(id)) {
				hostDiffityInFlightRef.current = false;
			}
		}
	})();
	return true;
}
