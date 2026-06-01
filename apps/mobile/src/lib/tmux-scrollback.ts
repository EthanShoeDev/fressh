const encoder = new TextEncoder();

export type TmuxControlWriter = {
	send: (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;
};

function escapeTmuxTarget(targetName: string): string {
	return targetName.replace(/'/g, "'\\''");
}

// Temporary mdev-boundary violation: scrollback entry and notification window
// selection still call tmux directly until mdev exposes app-callable wrappers.
// Do not add new direct tmux helpers here; move them behind mdev first.
export function buildTmuxScrollbackCopyModeCommand(targetName: string): string {
	const safeTarget = escapeTmuxTarget(targetName);
	return `tmux copy-mode -t '${safeTarget}'`;
}

export function buildTmuxScrollbackBatchCommand({
	targetName,
	direction,
	pages,
	lines,
}: {
	targetName: string;
	direction: 'up' | 'down';
	pages: number;
	lines: number;
}): string | null {
	const safeTarget = escapeTmuxTarget(targetName);
	const targetArg = `'${safeTarget}'`;
	const clampedPages = Math.max(0, pages);
	const clampedLines = Math.max(0, lines);
	const pageCmd = direction === 'up' ? 'page-up' : 'page-down';
	const lineCmd = direction === 'up' ? 'scroll-up' : 'scroll-down';
	const parts: string[] = [];

	if (clampedPages > 0) {
		parts.push(`send-keys -t ${targetArg} -N ${clampedPages} -X ${pageCmd}`);
	}
	if (clampedLines > 0) {
		parts.push(`send-keys -t ${targetArg} -N ${clampedLines} -X ${lineCmd}`);
	}
	if (parts.length === 0) return null;

	return `tmux ${parts.join(' \\; ')}`;
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

export function getTmuxScrollbackControlFailurePolicy({
	scrollbackActive,
}: {
	scrollbackActive: boolean;
}): 'exit-scrollback-and-restart-control' | 'restart-control-only' {
	if (scrollbackActive) return 'exit-scrollback-and-restart-control';
	return 'restart-control-only';
}

export type TmuxScrollbackLiveInputSendPlan =
	| {
			type: 'send';
			segments: Uint8Array<ArrayBuffer>[];
			interSegmentDelayMs?: number;
			clearScrollback: boolean;
	  }
	| {
			type: 'block';
			reason: 'invalid-cancel-key';
	  };

export function isValidTmuxCancelKey(
	cancelKey: Uint8Array<ArrayBuffer>,
): boolean {
	return cancelKey.length === 1 && cancelKey[0] !== 0x1b;
}

export function buildTmuxScrollbackLiveInputSendPlan({
	scrollbackActive,
	cancelKey,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	dropPayloadAfterExit = false,
}: {
	scrollbackActive: boolean;
	cancelKey: Uint8Array<ArrayBuffer>;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
	dropPayloadAfterExit?: boolean;
}): TmuxScrollbackLiveInputSendPlan {
	const nonEmptyPayloadSegments = payloadSegments.filter(
		(segment) => segment.length > 0,
	);

	if (!scrollbackActive) {
		return {
			type: 'send',
			segments: nonEmptyPayloadSegments,
			interSegmentDelayMs,
			clearScrollback: false,
		};
	}

	if (!isValidTmuxCancelKey(cancelKey)) {
		return {
			type: 'block',
			reason: 'invalid-cancel-key',
		};
	}

	return {
		type: 'send',
		segments: dropPayloadAfterExit
			? [cancelKey]
			: [cancelKey, ...nonEmptyPayloadSegments],
		interSegmentDelayMs: scrollbackExitDelayMs,
		clearScrollback: true,
	};
}
