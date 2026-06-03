import { buildHostBrowserStatusCycleCommand } from './host-browser-actions';
import { type RequestIdHandle } from './request-id';

export type WorkmuxStatusCycleRequestDeps = {
	tmuxEnabled: boolean;
	tmuxTarget: string;
	requestId: RequestIdHandle;
	inFlightRef: { current: boolean };
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
	requestId,
	inFlightRef,
	runHostBrowserCommand,
	showError,
	getErrorMessage,
}: WorkmuxStatusCycleRequestDeps): boolean {
	if (inFlightRef.current) return false;
	const id = requestId.next();
	inFlightRef.current = true;
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
			if (!requestId.isCurrent(id)) return;
			showError('Status cycle failed', getErrorMessage(err));
		} finally {
			if (requestId.isCurrent(id)) {
				inFlightRef.current = false;
			}
		}
	})();
	return true;
}
