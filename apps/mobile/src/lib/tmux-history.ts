export const TMUX_HISTORY_LIVE_LABEL = 'Bottom/Live';
const encoder = new TextEncoder();
const escapeChar = String.fromCharCode(27);
const bellChar = String.fromCharCode(7);
const oscSequencePattern = new RegExp(
	`${escapeChar}\\][^${bellChar}]*(?:${bellChar}|${escapeChar}\\\\)`,
	'g',
);
const csiSequencePattern = new RegExp(
	`${escapeChar}\\[[0-?]*[ -/]*[@-~]`,
	'g',
);

export const TMUX_HISTORY_COMMAND_IDS = [
	'UP',
	'DOWN',
	'PAGE_UP',
	'PAGE_DOWN',
	'TOP',
	'LIVE',
	'CLOSE',
] as const;

export type TmuxHistoryCommandId = (typeof TMUX_HISTORY_COMMAND_IDS)[number];
export type TmuxControlWriter = {
	send: (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;
};

const controlVerbs: Partial<Record<TmuxHistoryCommandId, string>> = {
	UP: 'scroll-up',
	DOWN: 'scroll-down',
	PAGE_UP: 'page-up',
	PAGE_DOWN: 'page-down',
	TOP: 'history-top',
};

function escapeTmuxTarget(targetName: string): string {
	return targetName.replace(/'/g, "'\\''");
}

export function buildTmuxHistoryControlCommand(
	commandId: TmuxHistoryCommandId,
	targetName: string,
): string | null {
	const verb = controlVerbs[commandId];
	if (!verb) return null;
	const safeTarget = escapeTmuxTarget(targetName);
	return `tmux send-keys -t '${safeTarget}' -X ${verb}`;
}

export function buildTmuxHistoryCopyModeCommand(targetName: string): string {
	const safeTarget = escapeTmuxTarget(targetName);
	return `tmux copy-mode -t '${safeTarget}'`;
}

export async function runTmuxControlCommand(
	writer: null | TmuxControlWriter,
	command: string,
): Promise<boolean> {
	if (!writer) return false;
	try {
		await writer.send(encoder.encode(`${command}\n`));
		return true;
	} catch {
		return false;
	}
}

export function buildTmuxHistoryEnterCommand(targetName: string): string {
	const safeTarget = escapeTmuxTarget(targetName);
	return `tmux copy-mode -t '${safeTarget}'; tmux display-message -p -t '${safeTarget}' '#{pane_in_mode}'`;
}

export function getTmuxHistoryFallbackSequence(
	_commandId: TmuxHistoryCommandId,
): string | null {
	return null;
}

export function isTmuxHistoryModeConfirmed(output: string): boolean {
	const meaningfulTokens = output
		.split(/\r?\n|\r/)
		.map((line) =>
			line
				.replace(oscSequencePattern, '')
				.replace(csiSequencePattern, '')
				.trim(),
		)
		.filter(Boolean);
	return meaningfulTokens.at(-1) === '1';
}

export function shouldApplyTmuxHistoryEntryResult({
	requestId,
	activeRequestId,
	requestedInstanceId,
	currentInstanceId,
}: {
	requestId: number;
	activeRequestId: number;
	requestedInstanceId: null | string;
	currentInstanceId: null | string;
}): boolean {
	return (
		requestId === activeRequestId &&
		requestedInstanceId !== null &&
		requestedInstanceId === currentInstanceId
	);
}

export function isTmuxHistoryBrowseActive({
	historyModeActive,
	scrollbackActive,
	pendingEnter,
}: {
	historyModeActive: boolean;
	scrollbackActive: boolean;
	pendingEnter: boolean;
}): boolean {
	return historyModeActive || scrollbackActive || pendingEnter;
}

export function getTmuxHistoryLiveInputPolicy({
	historyModeActive,
	scrollbackActive,
	pendingEnter,
}: {
	historyModeActive: boolean;
	scrollbackActive: boolean;
	pendingEnter: boolean;
}): 'block-pending-entry' | 'exit-before-send' | 'pass-through' {
	if (pendingEnter) return 'block-pending-entry';
	if (historyModeActive || scrollbackActive) return 'exit-before-send';
	return 'pass-through';
}

export function getTmuxHistoryControlFailurePolicy({
	historyModeActive,
	scrollbackActive,
	pendingEnter,
}: {
	historyModeActive: boolean;
	scrollbackActive: boolean;
	pendingEnter: boolean;
}): 'exit-browse-and-restart-control' | 'restart-control-only' {
	if (pendingEnter) return 'restart-control-only';
	if (historyModeActive || scrollbackActive) {
		return 'exit-browse-and-restart-control';
	}
	return 'restart-control-only';
}

export function getTmuxHistoryToggleAction({
	tmuxEnabled,
	tmuxControlReady,
	historyModeActive,
	scrollbackActive,
	pendingEnter,
}: {
	tmuxEnabled: boolean;
	tmuxControlReady: boolean;
	historyModeActive: boolean;
	scrollbackActive: boolean;
	pendingEnter: boolean;
}): 'adopt' | 'enter' | 'exit' | 'noop-disabled' | 'noop-pending' {
	if (pendingEnter) return 'noop-pending';
	if (historyModeActive) return 'exit';
	if (!tmuxEnabled || !tmuxControlReady) return 'noop-disabled';
	if (scrollbackActive) return 'adopt';
	return 'enter';
}
