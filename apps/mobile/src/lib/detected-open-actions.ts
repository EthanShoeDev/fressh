import {
	buildMdevOpenCommand,
	type HostBrowserOpenMode,
	type TmuxPaneContext,
} from '@/lib/host-browser-actions';

export type RunDetectedOpenCommandDeps = {
	mode: HostBrowserOpenMode;
	resolvePaneContext: () => Promise<TmuxPaneContext>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<string>;
};

export type DetectedOpenInFlightRef = { current: boolean };

export type DetectedOpenCallbackTarget = {
	onOpenDetectedAuto: () => boolean;
	onOpenDetectedPick: () => boolean;
};

export function tryBeginDetectedOpenRequest({
	inFlightRef,
	onBusy,
}: {
	inFlightRef: DetectedOpenInFlightRef;
	onBusy: () => void;
}): boolean {
	if (inFlightRef.current) {
		onBusy();
		return false;
	}
	inFlightRef.current = true;
	return true;
}

export function finishDetectedOpenRequest(
	inFlightRef: DetectedOpenInFlightRef,
) {
	inFlightRef.current = false;
}

export function getDetectedOpenTimeoutMs(mode: HostBrowserOpenMode): number {
	return mode === 'pick' ? 60_000 : 30_000;
}

export function runDetectedOpenCallback(
	mode: HostBrowserOpenMode,
	target: DetectedOpenCallbackTarget,
): boolean {
	return mode === 'pick'
		? target.onOpenDetectedPick()
		: target.onOpenDetectedAuto();
}

export async function runDetectedOpenCommand({
	mode,
	resolvePaneContext,
	runHostBrowserCommand,
}: RunDetectedOpenCommandDeps): Promise<void> {
	const context = await resolvePaneContext();
	await runHostBrowserCommand(
		buildMdevOpenCommand(mode, context),
		getDetectedOpenTimeoutMs(mode),
	);
}
