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

export type DetectedOpenShortcutItem = {
	type: string;
	bytes?: readonly number[];
};

const BROWSER_KEYBOARD_ID = 'browser_keyboard';
const DETECTED_OPEN_AUTO_BYTES = [27, 97] as const;
const DETECTED_OPEN_PICK_BYTES = [27, 65] as const;

function bytesEqual(
	actual: readonly number[] | undefined,
	expected: readonly number[],
): boolean {
	return (
		actual?.length === expected.length &&
		expected.every((byte, index) => actual[index] === byte)
	);
}

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

export function resolveDetectedOpenShortcutMode(
	keyboardId: string | null | undefined,
	item: DetectedOpenShortcutItem,
): HostBrowserOpenMode | null {
	if (keyboardId !== BROWSER_KEYBOARD_ID || item.type !== 'bytes') {
		return null;
	}
	if (bytesEqual(item.bytes, DETECTED_OPEN_AUTO_BYTES)) return 'auto';
	if (bytesEqual(item.bytes, DETECTED_OPEN_PICK_BYTES)) return 'pick';
	return null;
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
