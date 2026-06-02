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

type WorkmuxScrollbackCommandKind = 'enter' | 'scroll';

export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (
		command: string,
		options?: { rollbackExitCommand?: string },
	) => Promise<boolean>;
	enqueueScrollBatch: (commands: string[]) => Promise<boolean>;
	clearPendingScrollBatches: () => void;
	reset: (options?: { exitCommand?: string }) => Promise<boolean> | null;
	dispose: (options?: { exitCommand?: string }) => Promise<boolean> | null;
};

export function createWorkmuxScrollbackCommandExecutor({
	executeCommand,
	onFailure,
}: {
	executeCommand: (command: string) => Promise<WorkmuxScrollbackCommandResult>;
	onFailure: (message: string) => void;
}): WorkmuxScrollbackCommandExecutor {
	let tail: Promise<unknown> = Promise.resolve();
	let closed = false;
	let disposed = false;
	let workGeneration = 0;
	let exitGeneration = 0;
	let scrollDrainQueued = false;
	let pendingScrollBatch: {
		commands: string[];
		generation: number;
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

	const isWorkActive = (operationGeneration: number) =>
		!disposed && operationGeneration === workGeneration;
	const isExitActive = (operationGeneration: number) =>
		!disposed && operationGeneration === exitGeneration;

	const runCommands = async ({
		commands,
		commandKind,
		operationGeneration,
		rollbackExitCommand,
		durableExit = false,
	}: {
		commands: string[];
		commandKind: WorkmuxScrollbackCommandKind;
		operationGeneration: number;
		rollbackExitCommand?: string;
		durableExit?: boolean;
	}) => {
		const isActive = durableExit ? isExitActive : isWorkActive;
		if (disposed) return false;
		for (const command of commands) {
			if (!isActive(operationGeneration)) return false;
			const result = await runSingleCommand(command, executeCommand);
			if (!isActive(operationGeneration)) {
				if (commandKind === 'enter' && result.success && rollbackExitCommand) {
					await runSingleCommand(rollbackExitCommand, executeCommand);
				}
				return false;
			}
			const failureMessage =
				formatWorkmuxScrollbackCommandFailureMessage(result);
			if (!failureMessage) continue;
			clearPendingScrollBatches();
			onFailure(failureMessage);
			return false;
		}
		return true;
	};

	const reset = (options?: { exitCommand?: string }) => {
		workGeneration += 1;
		clearPendingScrollBatches();
		const exitCommand = options?.exitCommand;
		if (disposed || !exitCommand) return null;

		exitGeneration += 1;
		const operationGeneration = exitGeneration;
		return enqueueSerialized(() =>
			runCommands({
				commands: [exitCommand],
				commandKind: 'scroll',
				operationGeneration,
				durableExit: true,
			}),
		);
	};

	return {
		runEnterCommand: (
			command: string,
			options?: { rollbackExitCommand?: string },
		) =>
			closed || disposed
				? Promise.resolve(false)
				: (() => {
						const operationGeneration = workGeneration;
						return enqueueSerialized(() =>
							runCommands({
								commands: [command],
								commandKind: 'enter',
								operationGeneration,
								rollbackExitCommand: options?.rollbackExitCommand,
							}),
						);
					})(),
		enqueueScrollBatch: (commands: string[]) => {
			if (closed || disposed) return Promise.resolve(false);
			if (commands.length === 0) return Promise.resolve(true);
			const promise = new Promise<boolean>((resolve) => {
				pendingScrollBatch?.resolve(false);
				pendingScrollBatch = { commands, generation: workGeneration, resolve };
			});

			if (!scrollDrainQueued) {
				scrollDrainQueued = true;
				void enqueueSerialized(async () => {
					scrollDrainQueued = false;
					if (disposed) {
						clearPendingScrollBatches();
						return false;
					}
					const batch = pendingScrollBatch;
					pendingScrollBatch = null;
					if (!batch) return true;
					const success = await runCommands({
						commands: batch.commands,
						commandKind: 'scroll',
						operationGeneration: batch.generation,
					});
					batch.resolve(success);
					return success;
				});
			}

			return promise;
		},
		clearPendingScrollBatches,
		reset,
		dispose: (options?: { exitCommand?: string }) => {
			closed = true;
			const exit = reset(options);
			if (exit) {
				void exit.finally(() => {
					disposed = true;
				});
			} else {
				disposed = true;
			}
			return exit;
		},
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
	remoteCopyModeExitCommand,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	remoteCopyModeExitCommand?: string;
}): Promise<boolean> | null {
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	return (
		commandExecutor?.reset({ exitCommand: remoteCopyModeExitCommand }) ?? null
	);
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

export function handleWorkmuxScrollbackCommandFailureActions({
	message,
	alert,
	copyMessage,
	clearScrollbackState,
	warn,
}: {
	message: string;
	alert: (
		title: string,
		message: string,
		buttons?: { text: string; onPress?: () => void }[],
	) => void;
	copyMessage: (message: string) => void;
	clearScrollbackState: () => void;
	warn: (message: string) => void;
}): void {
	warn(message);
	alert('Workmux scroll unavailable', message, [
		{ text: 'Copy Message', onPress: () => copyMessage(message) },
		{ text: 'OK' },
	]);

	clearScrollbackState();
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

export type TmuxScrollbackLiveInputSendPlan = {
	type: 'send';
	segments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	clearScrollback: boolean;
};

export function buildTmuxScrollbackLiveInputSendPlan({
	scrollbackActive,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
	dropPayloadAfterExit = false,
}: {
	scrollbackActive: boolean;
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

	return {
		type: 'send',
		segments: dropPayloadAfterExit ? [] : nonEmptyPayloadSegments,
		interSegmentDelayMs: scrollbackExitDelayMs,
		clearScrollback: true,
	};
}
