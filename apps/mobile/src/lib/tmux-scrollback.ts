const encoder = new TextEncoder();

export type TmuxControlWriter = {
	send: (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;
};

function escapeTmuxTarget(targetName: string): string {
	return targetName.replace(/'/g, "'\\''");
}

export function buildTmuxScrollbackCopyModeCommand(targetName: string): string {
	const safeTarget = escapeTmuxTarget(targetName);
	return `tmux copy-mode -t '${safeTarget}'`;
}

export function buildTmuxSelectWindowCommand(
	sessionName: string,
	windowId: string,
): string {
	const safeTarget = escapeTmuxTarget(`${sessionName}:${windowId}`);
	return `tmux select-window -t '${safeTarget}'`;
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

export function getTmuxScrollbackLiveInputPolicy({
	scrollbackActive,
}: {
	scrollbackActive: boolean;
}): 'exit-before-send' | 'pass-through' {
	if (scrollbackActive) return 'exit-before-send';
	return 'pass-through';
}

export function getTmuxScrollbackControlFailurePolicy({
	scrollbackActive,
}: {
	scrollbackActive: boolean;
}): 'exit-scrollback-and-restart-control' | 'restart-control-only' {
	if (scrollbackActive) return 'exit-scrollback-and-restart-control';
	return 'restart-control-only';
}
