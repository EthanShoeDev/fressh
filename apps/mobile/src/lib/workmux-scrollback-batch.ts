import {
	WORKMUX_APP_SCROLL_MAX_COUNT,
	type WorkmuxScrollDirection,
} from './workmux-app-commands';

// Bounds malformed bridge batches before splitting into remote commands.
export const TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH = 100;
export const TMUX_SCROLLBACK_EXECUTOR_MAX_PENDING_PAGES = 100;

export type TmuxScrollbackLineAccumulator = {
	direction: WorkmuxScrollDirection | null;
	lines: number;
};

export type WorkmuxScrollbackPageCommand = {
	sessionName: string;
	direction: WorkmuxScrollDirection;
	count: number;
};

export function mergeWorkmuxScrollbackPageCommands(
	commands: WorkmuxScrollbackPageCommand[],
): WorkmuxScrollbackPageCommand[] {
	const merged: WorkmuxScrollbackPageCommand[] = [];
	for (const command of commands) {
		let remainingCount = command.count;
		while (remainingCount > 0) {
			const count = Math.min(remainingCount, WORKMUX_APP_SCROLL_MAX_COUNT);
			const previous = merged[merged.length - 1];
			if (
				previous &&
				previous.sessionName === command.sessionName &&
				previous.direction === command.direction &&
				previous.count < WORKMUX_APP_SCROLL_MAX_COUNT
			) {
				const available = WORKMUX_APP_SCROLL_MAX_COUNT - previous.count;
				const appended = Math.min(available, count);
				previous.count += appended;
				remainingCount -= appended;
				continue;
			}
			merged.push({
				sessionName: command.sessionName,
				direction: command.direction,
				count,
			});
			remainingCount -= count;
		}
	}
	return merged;
}

export function coalesceWorkmuxScrollbackPendingPageCommands(
	commands: WorkmuxScrollbackPageCommand[],
): WorkmuxScrollbackPageCommand[] {
	let sessionName: string | null = null;
	let netPages = 0;
	for (const command of commands) {
		sessionName = command.sessionName;
		netPages += command.direction === 'up' ? command.count : -command.count;
		if (Math.abs(netPages) > TMUX_SCROLLBACK_EXECUTOR_MAX_PENDING_PAGES) {
			netPages =
				Math.sign(netPages) * TMUX_SCROLLBACK_EXECUTOR_MAX_PENDING_PAGES;
		}
	}
	if (!sessionName || netPages === 0) return [];
	return [
		{
			sessionName,
			direction: netPages > 0 ? 'up' : 'down',
			count: Math.abs(netPages),
		},
	];
}

export function createTmuxScrollbackLineAccumulator(): TmuxScrollbackLineAccumulator {
	return {
		direction: null,
		lines: 0,
	};
}

export function clearTmuxScrollbackLineAccumulator(
	lineAccumulator: TmuxScrollbackLineAccumulator,
): void {
	lineAccumulator.direction = null;
	lineAccumulator.lines = 0;
}

export function accumulateWorkmuxScrollbackBatchCommands({
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
}): WorkmuxScrollbackPageCommand[] {
	const explicitPageCount = truncateNonNegativeInteger(pages);
	const lineCount = truncateNonNegativeInteger(lines);
	const pageSize = Math.max(1, truncateNonNegativeInteger(linesPerPage));
	const signedPreviousLines =
		lineAccumulator.direction === 'up'
			? lineAccumulator.lines
			: -lineAccumulator.lines;
	const signedBatchDirection = direction === 'up' ? 1 : -1;
	const signedBatchLines =
		signedBatchDirection * (explicitPageCount * pageSize + lineCount);
	const signedTotalLines = signedPreviousLines + signedBatchLines;
	const totalDirection =
		signedTotalLines >= 0 ? 'up' : ('down' as WorkmuxScrollDirection);
	const totalLines = Math.abs(signedTotalLines);
	const pageCount = Math.min(
		Math.trunc(totalLines / pageSize),
		TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
	);
	const leftoverLines = totalLines % pageSize;

	lineAccumulator.direction = leftoverLines === 0 ? null : totalDirection;
	lineAccumulator.lines = leftoverLines;

	if (pageCount === 0) return [];

	const commands: WorkmuxScrollbackPageCommand[] = [];
	for (
		let remainingPages = pageCount;
		remainingPages > 0;
		remainingPages -= WORKMUX_APP_SCROLL_MAX_COUNT
	) {
		commands.push({
			sessionName,
			direction: totalDirection,
			count: Math.min(remainingPages, WORKMUX_APP_SCROLL_MAX_COUNT),
		});
	}
	return commands;
}

function truncateNonNegativeInteger(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(value)));
}

export function isValidScrollbackBatchEvent(event: {
	direction: unknown;
	pages: unknown;
	lines: unknown;
	pageStep: unknown;
}): event is {
	direction: WorkmuxScrollDirection;
	pages: number;
	lines: number;
	pageStep: number;
} {
	return (
		(event.direction === 'up' || event.direction === 'down') &&
		typeof event.pages === 'number' &&
		Number.isFinite(event.pages) &&
		event.pages >= 0 &&
		typeof event.lines === 'number' &&
		Number.isFinite(event.lines) &&
		event.lines >= 0 &&
		typeof event.pageStep === 'number' &&
		Number.isFinite(event.pageStep) &&
		event.pageStep > 0
	);
}
