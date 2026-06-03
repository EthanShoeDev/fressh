import { buildHostBrowserStatusCycleCommand } from './host-browser-actions';
import { type RequestIdHandle } from './request-id';

export type WorkmuxStatusCycleHandle = {
	start: () => number | null;
	isCurrent: (id: number) => boolean;
	invalidate: () => void;
};

export function createWorkmuxStatusCycleHandle({
	requestId,
	inFlightRef,
}: {
	requestId: RequestIdHandle;
	inFlightRef: { current: boolean };
}): WorkmuxStatusCycleHandle {
	return {
		start: () => {
			if (inFlightRef.current) return null;
			const id = requestId.next();
			inFlightRef.current = true;
			return id;
		},
		isCurrent: (id) => requestId.isCurrent(id),
		invalidate: () => {
			requestId.invalidate();
			inFlightRef.current = false;
		},
	};
}

export type WorkmuxStatusCycleRequestDeps = {
	tmuxEnabled: boolean;
	tmuxTarget: string;
	handle: WorkmuxStatusCycleHandle;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	showError: (title: string, message: string) => void;
	getErrorMessage: (error: unknown) => string;
};

export function runWorkmuxStatusCycleRequest({
	tmuxEnabled,
	tmuxTarget,
	handle,
	runHostBrowserCommand,
	showError,
	getErrorMessage,
}: WorkmuxStatusCycleRequestDeps): boolean {
	const id = handle.start();
	if (id == null) return false;
	void (async () => {
		try {
			if (!tmuxEnabled) {
				throw new Error('Status cycle requires a tmux-enabled connection.');
			}
			const sessionName = tmuxTarget.trim() || 'main';
			await runHostBrowserCommand(
				buildHostBrowserStatusCycleCommand(sessionName),
				10_000,
			);
		} catch (err) {
			if (!handle.isCurrent(id)) return;
			showError('Status cycle failed', getErrorMessage(err));
		} finally {
			if (handle.isCurrent(id)) handle.invalidate();
		}
	})();
	return true;
}
