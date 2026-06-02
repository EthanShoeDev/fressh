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

export type WorkmuxScrollbackCommandResult = {
	success: boolean;
	output: string;
	error?: string;
};

export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (command: string) => Promise<boolean>;
	enqueueScrollBatch: (commands: string[]) => Promise<boolean>;
	clearPendingScrollBatches: () => void;
	getPendingScrollBatchCount: () => number;
};

export function createWorkmuxScrollbackCommandExecutor({
	executeCommand,
	onFailure,
}: {
	executeCommand: (command: string) => Promise<WorkmuxScrollbackCommandResult>;
	onFailure: (message: string) => void;
}): WorkmuxScrollbackCommandExecutor {
	let tail: Promise<unknown> = Promise.resolve();
	let scrollDrainQueued = false;
	let pendingScrollBatch: {
		commands: string[];
		resolve: (value: boolean) => void;
	} | null = null;

	const clearPendingScrollBatches = () => {
		pendingScrollBatch?.resolve(false);
		pendingScrollBatch = null;
	};

	const enqueueSerialized = <T>(operation: () => Promise<T>) => {
		const next = tail.then(operation, operation);
		tail = next.catch(() => {});
		return next;
	};

	const runCommands = async (commands: string[]) => {
		for (const command of commands) {
			const result = await runSingleCommand(command, executeCommand);
			const failureMessage =
				formatWorkmuxScrollbackCommandFailureMessage(result);
			if (!failureMessage) continue;
			clearPendingScrollBatches();
			onFailure(failureMessage);
			return false;
		}
		return true;
	};

	return {
		runEnterCommand: (command: string) =>
			enqueueSerialized(() => runCommands([command])),
		enqueueScrollBatch: (commands: string[]) => {
			if (commands.length === 0) return Promise.resolve(true);
			const promise = new Promise<boolean>((resolve) => {
				pendingScrollBatch?.resolve(false);
				pendingScrollBatch = { commands, resolve };
			});

			if (!scrollDrainQueued) {
				scrollDrainQueued = true;
				void enqueueSerialized(async () => {
					scrollDrainQueued = false;
					const batch = pendingScrollBatch;
					pendingScrollBatch = null;
					if (!batch) return true;
					const success = await runCommands(batch.commands);
					batch.resolve(success);
					return success;
				});
			}

			return promise;
		},
		clearPendingScrollBatches,
		getPendingScrollBatchCount: () => (pendingScrollBatch ? 1 : 0),
	};
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

export function resetTmuxScrollbackRuntimeState({
	lineAccumulator,
	commandExecutor,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
}): void {
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	commandExecutor?.clearPendingScrollBatches();
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

async function runSingleCommand(
	command: string,
	executeCommand: (command: string) => Promise<WorkmuxScrollbackCommandResult>,
): Promise<WorkmuxScrollbackCommandResult> {
	try {
		return await executeCommand(command);
	} catch (error) {
		return {
			success: false,
			output: '',
			error: error instanceof Error ? error.message : String(error),
		};
	}
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
