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

export type DetectedOpenShortcutSpec = {
	mode: HostBrowserOpenMode;
	keyboardId: string;
	bytes: readonly number[];
	actionId: DetectedOpenShortcutActionId;
};

export type DetectedOpenShortcutActionId =
	| 'OPEN_HOST_DETECTED_AUTO'
	| 'OPEN_HOST_DETECTED_PICK';

export type DetectedOpenShortcutPressPlan =
	| { type: 'action'; actionId: DetectedOpenShortcutActionId }
	| { type: 'bytes'; bytes: readonly number[] };

// These bytes are reserved by the bundled browser keyboard for old-client
// compatibility; new clients intercept them before writing to the terminal.
export const DETECTED_OPEN_SHORTCUTS = [
	{
		mode: 'auto',
		keyboardId: 'browser_keyboard',
		bytes: [27, 97],
		actionId: 'OPEN_HOST_DETECTED_AUTO',
	},
	{
		mode: 'pick',
		keyboardId: 'browser_keyboard',
		bytes: [27, 65],
		actionId: 'OPEN_HOST_DETECTED_PICK',
	},
] as const satisfies readonly DetectedOpenShortcutSpec[];

export const DETECTED_OPEN_ACTION_IDS = DETECTED_OPEN_SHORTCUTS.map(
	(shortcut) => shortcut.actionId,
);

export type DetectedOpenRequestId = {
	next: () => number;
	isCurrent: (requestId: number) => boolean;
};

export type RunDetectedOpenControllerRequestDeps =
	RunDetectedOpenCommandDeps & {
		inFlightRef: DetectedOpenInFlightRef;
		requestId: DetectedOpenRequestId;
		setOpen: (open: boolean) => void;
		showError: (title: string, message: string) => void;
		getErrorMessage: (error: unknown) => string;
	};

export type DetectedOpenControllerRequestResult =
	| { accepted: false; completion: null }
	| { accepted: true; completion: Promise<void> };

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
	const shortcut = DETECTED_OPEN_SHORTCUTS.find(
		(entry) =>
			entry.keyboardId === keyboardId &&
			item.type === 'bytes' &&
			bytesEqual(item.bytes, entry.bytes),
	);
	return shortcut?.mode ?? null;
}

export function planDetectedOpenShortcutPress(
	keyboardId: string | null | undefined,
	item: { type: 'bytes'; bytes: readonly number[] },
): DetectedOpenShortcutPressPlan {
	const mode = resolveDetectedOpenShortcutMode(keyboardId, item);
	const shortcut = DETECTED_OPEN_SHORTCUTS.find((entry) => entry.mode === mode);
	if (shortcut) return { type: 'action', actionId: shortcut.actionId };
	return { type: 'bytes', bytes: item.bytes };
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

export function runDetectedOpenControllerRequest({
	mode,
	inFlightRef,
	requestId,
	resolvePaneContext,
	runHostBrowserCommand,
	setOpen,
	showError,
	getErrorMessage,
}: RunDetectedOpenControllerRequestDeps): DetectedOpenControllerRequestResult {
	if (
		!tryBeginDetectedOpenRequest({
			inFlightRef,
			onBusy: () => {
				showError(
					'Open already running',
					'Wait for the current browser action to finish.',
				);
			},
		})
	) {
		return { accepted: false, completion: null };
	}
	setOpen(false);
	const id = requestId.next();
	const completion = (async () => {
		try {
			await runDetectedOpenCommand({
				mode,
				resolvePaneContext,
				runHostBrowserCommand: async (command, timeoutMs) => {
					if (!requestId.isCurrent(id)) return '';
					return runHostBrowserCommand(command, timeoutMs);
				},
			});
		} catch (err) {
			if (!requestId.isCurrent(id)) return;
			showError(
				mode === 'pick' ? 'Pick failed' : 'Open failed',
				getErrorMessage(err),
			);
		} finally {
			if (requestId.isCurrent(id)) {
				finishDetectedOpenRequest(inFlightRef);
			}
		}
	})();
	return { accepted: true, completion };
}
