import {
	WORKMUX_APP_SCROLL_MAX_COUNT,
	buildWorkmuxAppScrollPageCommand,
	formatWorkmuxAppCommandFailureMessage,
	type WorkmuxScrollDirection,
} from './workmux-app-commands';

// Bounds malformed bridge batches before splitting into remote commands.
export const TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH = 100;

export type TmuxScrollbackLineAccumulator = {
	direction: WorkmuxScrollDirection | null;
	lines: number;
};

export type WorkmuxScrollbackCommandQueue = {
	enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
};

export function createWorkmuxScrollbackCommandQueue(): WorkmuxScrollbackCommandQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return {
		enqueue: <T>(operation: () => Promise<T>) => {
			const next = tail.then(operation, operation);
			tail = next.catch(() => {});
			return next;
		},
	};
}

export function createTmuxScrollbackLineAccumulator(): TmuxScrollbackLineAccumulator {
	return {
		direction: null,
		lines: 0,
	};
}

export function resolveTmuxScrollbackReceiverLinesPerPage(
	rows: number | null | undefined,
): number {
	const rowCount = rows == null ? 24 : truncateNonNegativeInteger(rows);
	return Math.max(10, rowCount - 1);
}

export function clearTmuxScrollbackLineAccumulator(
	lineAccumulator: TmuxScrollbackLineAccumulator,
): void {
	lineAccumulator.direction = null;
	lineAccumulator.lines = 0;
}

export function buildWorkmuxScrollbackBatchCommands({
	sessionName,
	direction,
	pages,
	lines,
	linesPerPage,
	lineAccumulator,
}: {
	sessionName: string;
	direction: WorkmuxScrollDirection;
	pages: number;
	lines: number;
	linesPerPage: number;
	lineAccumulator: TmuxScrollbackLineAccumulator;
}): string[] {
	let pageCount = truncateNonNegativeInteger(pages);
	const lineCount = truncateNonNegativeInteger(lines);
	const pageSize = Math.max(1, truncateNonNegativeInteger(linesPerPage));

	if (lineAccumulator.direction !== direction) {
		clearTmuxScrollbackLineAccumulator(lineAccumulator);
		lineAccumulator.direction = direction;
	}

	if (lineCount > 0) {
		lineAccumulator.lines += lineCount;
		pageCount += Math.trunc(lineAccumulator.lines / pageSize);
		lineAccumulator.lines %= pageSize;
	}
	pageCount = Math.min(pageCount, TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH);

	if (pageCount === 0) return [];

	const commands: string[] = [];
	for (
		let remainingPages = pageCount;
		remainingPages > 0;
		remainingPages -= WORKMUX_APP_SCROLL_MAX_COUNT
	) {
		commands.push(
			buildWorkmuxAppScrollPageCommand(
				sessionName,
				direction,
				Math.min(remainingPages, WORKMUX_APP_SCROLL_MAX_COUNT),
			),
		);
	}
	return commands;
}

export function formatWorkmuxScrollbackCommandFailureMessage(result: {
	success: boolean;
	output: string;
	error?: string;
}): string | null {
	if (result.success) return null;
	return formatWorkmuxAppCommandFailureMessage(
		result.error || result.output || '',
	);
}

function truncateNonNegativeInteger(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(value)));
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
