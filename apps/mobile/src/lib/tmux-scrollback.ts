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
type WorkmuxScrollbackFailurePolicy = 'notify' | 'suppress';

export type WorkmuxScrollbackFailureContext = {
	commandKind: 'enter' | 'scroll' | 'exit';
};

export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (
		command: string,
		options?: { rollbackExitCommand?: string },
	) => Promise<boolean>;
	enqueueScrollBatch: (commands: string[]) => Promise<boolean>;
	reset: (options?: {
		exitCommand?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => Promise<boolean> | null;
	dispose: (options?: { exitCommand?: string }) => Promise<boolean> | null;
};

export function createWorkmuxScrollbackCommandExecutor({
	executeCommand,
	onFailure,
	onDisposeExitFailure,
}: {
	executeCommand: (command: string) => Promise<WorkmuxScrollbackCommandResult>;
	onFailure: (
		message: string,
		context: WorkmuxScrollbackFailureContext,
	) => void;
	onDisposeExitFailure?: (message: string) => void;
}): WorkmuxScrollbackCommandExecutor {
	let tail: Promise<unknown> = Promise.resolve();
	let closed = false;
	let disposed = false;
	let workGeneration = 0;
	let exitGeneration = 0;
	let pendingEnterOperations = 0;
	let pendingSerializedOperations = 0;
	let canceledEnterRollbackSucceeded = true;
	let canceledEnterRollbackFailurePolicy: WorkmuxScrollbackFailurePolicy =
		'notify';
	let scrollDrainQueued = false;
	let pendingScrollBatch: {
		commands: string[];
		generation: number;
		resolveAll: (value: boolean) => void;
	} | null = null;

	const clearPendingScrollBatches = () => {
		pendingScrollBatch?.resolveAll(false);
		pendingScrollBatch = null;
	};

	const enqueueSerialized = <T>(operation: () => Promise<T>) => {
		pendingSerializedOperations += 1;
		const next = tail.then(operation, operation).finally(() => {
			pendingSerializedOperations -= 1;
		});
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
		failurePolicy = 'notify',
	}: {
		commands: string[];
		commandKind: WorkmuxScrollbackCommandKind;
		operationGeneration: number;
		rollbackExitCommand?: string;
		durableExit?: boolean;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => {
		const isActive = durableExit ? isExitActive : isWorkActive;
		if (disposed) return false;
		for (const command of commands) {
			if (!isActive(operationGeneration)) return false;
			const result = await runSingleCommand(command, executeCommand);
			if (!isActive(operationGeneration)) {
				if (commandKind === 'enter' && result.success && rollbackExitCommand) {
					const rollbackResult = await runSingleCommand(
						rollbackExitCommand,
						executeCommand,
					);
					const rollbackFailureMessage =
						formatWorkmuxScrollbackCommandFailureMessage(rollbackResult);
					canceledEnterRollbackSucceeded =
						canceledEnterRollbackSucceeded && !rollbackFailureMessage;
					if (rollbackFailureMessage) {
						if (canceledEnterRollbackFailurePolicy === 'notify') {
							onFailure(rollbackFailureMessage, { commandKind: 'exit' });
						} else {
							onDisposeExitFailure?.(rollbackFailureMessage);
						}
					}
				}
				return false;
			}
			const failureMessage =
				formatWorkmuxScrollbackCommandFailureMessage(result);
			if (!failureMessage) continue;
			clearPendingScrollBatches();
			if (failurePolicy === 'notify') {
				onFailure(failureMessage, {
					commandKind: durableExit ? 'exit' : commandKind,
				});
			} else {
				onDisposeExitFailure?.(failureMessage);
			}
			return false;
		}
		return true;
	};

	const reset = (options?: {
		exitCommand?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => {
		const hadPendingEnter = pendingEnterOperations > 0;
		const hadSerializedWork = pendingSerializedOperations > 0;
		canceledEnterRollbackSucceeded = true;
		canceledEnterRollbackFailurePolicy = options?.failurePolicy ?? 'notify';
		workGeneration += 1;
		clearPendingScrollBatches();
		const exitCommand = options?.exitCommand;
		if (disposed) return null;
		if (!exitCommand) {
			if (!hadPendingEnter || !hadSerializedWork) return null;
			return enqueueSerialized(async () => canceledEnterRollbackSucceeded);
		}

		exitGeneration += 1;
		const operationGeneration = exitGeneration;
		return enqueueSerialized(() =>
			runCommands({
				commands: [exitCommand],
				commandKind: 'scroll',
				operationGeneration,
				durableExit: true,
				failurePolicy: options?.failurePolicy,
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
						pendingEnterOperations += 1;
						const operationGeneration = workGeneration;
						return enqueueSerialized(async () => {
							try {
								return await runCommands({
									commands: [command],
									commandKind: 'enter',
									operationGeneration,
									rollbackExitCommand: options?.rollbackExitCommand,
								});
							} finally {
								pendingEnterOperations -= 1;
							}
						});
					})(),
		enqueueScrollBatch: (commands: string[]) => {
			if (closed || disposed) return Promise.resolve(false);
			if (commands.length === 0) return Promise.resolve(true);
			const promise = new Promise<boolean>((resolve) => {
				if (pendingScrollBatch && pendingScrollBatch.generation === workGeneration) {
					const previousResolve = pendingScrollBatch.resolveAll;
					pendingScrollBatch.commands.push(...commands);
					pendingScrollBatch.resolveAll = (value) => {
						previousResolve(value);
						resolve(value);
					};
					return;
				}
				pendingScrollBatch?.resolveAll(false);
				pendingScrollBatch = {
					commands: [...commands],
					generation: workGeneration,
					resolveAll: resolve,
				};
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
					batch.resolveAll(success);
					return success;
				});
			}

			return promise;
		},
		reset,
		dispose: (options?: { exitCommand?: string }) => {
			closed = true;
			const exit = reset({
				exitCommand: options?.exitCommand,
				failurePolicy: 'suppress',
			});
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

export function handleTmuxScrollbackInactiveAppStateTransition({
	previousState,
	nextState,
	clearScrollbackState,
	onCleanupError,
}: {
	previousState: string;
	nextState: string;
	clearScrollbackState: () => Promise<boolean> | null;
	onCleanupError: (error: unknown) => void;
}): Promise<boolean> | null {
	if (previousState !== 'active' || nextState === 'active') return null;
	const cleanup = clearScrollbackState();
	void cleanup?.catch(onCleanupError);
	return cleanup;
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

	const commands: string[] = [];
	for (
		let remainingPages = pageCount;
		remainingPages > 0;
		remainingPages -= WORKMUX_APP_SCROLL_MAX_COUNT
	) {
		commands.push(
			buildWorkmuxAppScrollPageCommand(
				sessionName,
				totalDirection,
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
	segments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	clearScrollback: boolean;
};

export type TmuxScrollbackLiveInputCleanupBarrier = {
	current: () => Promise<boolean> | null;
	track: (cleanup?: Promise<boolean> | null) => Promise<boolean> | null;
};

export function createTmuxScrollbackLiveInputCleanupBarrier(): TmuxScrollbackLiveInputCleanupBarrier {
	let pendingCleanup: Promise<boolean> | null = null;

	return {
		current: () => pendingCleanup,
		track: (cleanup?: Promise<boolean> | null) => {
			if (!cleanup) return pendingCleanup;
			const barrier = cleanup.finally(() => {
				if (pendingCleanup === barrier) {
					pendingCleanup = null;
				}
			});
			pendingCleanup = barrier;
			return barrier;
		},
	};
}

export function registerTmuxScrollbackLiveInputCleanup(
	barrier: TmuxScrollbackLiveInputCleanupBarrier,
	cleanup?: Promise<boolean> | null,
): Promise<boolean> | null {
	return barrier.track(cleanup);
}

export function registerTmuxScrollbackRemoteCopyModeExitCleanup({
	barrier,
	cleanup,
	remoteCopyModeActiveRef,
	remoteCopyModeWasActive = remoteCopyModeActiveRef.current,
	markRemoteCopyModeActiveOnFailedCleanup = false,
	cleanupGeneration,
}: {
	barrier: TmuxScrollbackLiveInputCleanupBarrier;
	cleanup?: Promise<boolean> | null;
	remoteCopyModeActiveRef: { current: boolean };
	remoteCopyModeWasActive?: boolean;
	markRemoteCopyModeActiveOnFailedCleanup?: boolean;
	cleanupGeneration?: { current: number };
}): Promise<boolean> | null {
	const generation = cleanupGeneration?.current;
	const trackedCleanup = registerTmuxScrollbackLiveInputCleanup(
		barrier,
		cleanup,
	);
	void trackedCleanup
		?.then((exited) => {
			if (
				generation !== undefined &&
				cleanupGeneration?.current !== generation
			) {
				return;
			}
			if (exited) {
				remoteCopyModeActiveRef.current = false;
				return;
			}
			if (remoteCopyModeWasActive || markRemoteCopyModeActiveOnFailedCleanup) {
				remoteCopyModeActiveRef.current = true;
			}
		})
		.catch(() => {});
	return trackedCleanup;
}

export function resetTmuxScrollbackRuntimeStateForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	remoteCopyModeExitCommand,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: TmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	remoteCopyModeExitCommand: string;
}): Promise<boolean> | null {
	const remoteCopyModeWasActive = remoteCopyModeActiveRef.current;
	const reset = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor,
		remoteCopyModeExitCommand: remoteCopyModeWasActive
			? remoteCopyModeExitCommand
			: undefined,
	});
	return registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup: reset,
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive,
		markRemoteCopyModeActiveOnFailedCleanup: true,
		cleanupGeneration,
	});
}

export function shouldRunTmuxScrollbackRemoteResetForModeChange({
	active,
	requestId,
	localExitRequestIds,
}: {
	active: boolean;
	requestId?: number;
	localExitRequestIds: Set<number>;
}): boolean {
	if (active) return false;
	if (requestId !== undefined && localExitRequestIds.delete(requestId)) {
		return false;
	}
	return true;
}

export function shouldRequestWorkmuxScrollbackEnter({
	isAppActive,
	instanceId,
	currentInstanceId,
}: {
	isAppActive: boolean;
	instanceId: string;
	currentInstanceId?: string | null;
}): boolean {
	if (currentInstanceId && instanceId !== currentInstanceId) return false;
	return isAppActive;
}

export function buildTmuxScrollbackLiveInputSendPlan({
	scrollbackActive,
	payloadSegments,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
}: {
	scrollbackActive: boolean;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
}): TmuxScrollbackLiveInputSendPlan {
	const nonEmptyPayloadSegments = payloadSegments.filter(
		(segment) => segment.length > 0,
	);

	if (!scrollbackActive) {
		return {
			segments: nonEmptyPayloadSegments,
			interSegmentDelayMs,
			clearScrollback: false,
		};
	}

	return {
		segments: nonEmptyPayloadSegments,
		interSegmentDelayMs: scrollbackExitDelayMs,
		clearScrollback: true,
	};
}
