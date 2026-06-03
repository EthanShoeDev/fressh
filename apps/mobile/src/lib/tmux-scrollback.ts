import {
	WORKMUX_APP_SCROLL_MAX_COUNT,
	buildWorkmuxAppScrollEnterCommand,
	buildWorkmuxAppScrollExitCommand,
	buildWorkmuxAppScrollPageCommand,
	formatWorkmuxAppBoundaryFailureMessage,
	type WorkmuxScrollDirection,
} from './workmux-app-commands';

// Bounds malformed bridge batches before splitting into remote commands.
export const TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH = 100;
export const TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT = 100;
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

function coalesceWorkmuxScrollbackPendingPageCommands(
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

export function registerTmuxScrollbackLocalExitRequest({
	requestIds,
	requestId,
}: {
	requestIds: Set<number>;
	requestId: number;
}) {
	while (requestIds.size >= TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT) {
		const oldestRequestId = requestIds.values().next().value;
		if (oldestRequestId === undefined) break;
		requestIds.delete(oldestRequestId);
	}
	requestIds.add(requestId);
}

export function createTmuxScrollbackLocalExitRequest({
	requestIds,
	requestId,
	instanceId,
}: {
	requestIds: Set<number>;
	requestId: number;
	instanceId: string | null;
}): { message: { requestId: number; instanceId?: string } } {
	registerTmuxScrollbackLocalExitRequest({ requestIds, requestId });
	return {
		message:
			instanceId == null
				? { requestId }
				: {
						requestId,
						instanceId,
					},
	};
}

export function resetTmuxScrollbackLocalExitRequests(requestIds: Set<number>) {
	requestIds.clear();
}

export type WorkmuxScrollbackCommandResult = {
	success: boolean;
	output: string;
	error?: string;
};

type WorkmuxScrollbackCommandKind = 'enter' | 'scroll';
export type WorkmuxScrollbackFailurePolicy = 'notify' | 'suppress';

export type WorkmuxScrollbackFailureContext = {
	commandKind: 'enter' | 'scroll' | 'exit';
};

export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (
		command: string,
		options?: { rollbackExitCommand?: string },
	) => Promise<boolean>;
	enqueueScrollBatch: (commands: WorkmuxScrollbackPageCommand[]) => Promise<boolean>;
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
		commands: WorkmuxScrollbackPageCommand[];
		generation: number;
		resolvers: ((value: boolean) => void)[];
	} | null = null;

	const notifyFailure = (
		message: string,
		context: WorkmuxScrollbackFailureContext,
	) => {
		try {
			onFailure(message, context);
		} catch {
			// Failure notification is best-effort; command promises must still settle.
		}
	};

	const notifyDisposeExitFailure = (message: string) => {
		try {
			onDisposeExitFailure?.(message);
		} catch {
			// Failure notification is best-effort; command promises must still settle.
		}
	};

	const clearPendingScrollBatches = () => {
		for (const resolve of pendingScrollBatch?.resolvers ?? []) {
			resolve(false);
		}
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
				const failureMessage =
					formatWorkmuxScrollbackCommandFailureMessage(result);
				if (failureMessage && commandKind === 'enter' && !disposed) {
					canceledEnterRollbackSucceeded = false;
					if (canceledEnterRollbackFailurePolicy === 'notify') {
						notifyFailure(failureMessage, { commandKind: 'enter' });
					} else {
						notifyDisposeExitFailure(failureMessage);
					}
				}
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
							notifyFailure(rollbackFailureMessage, { commandKind: 'exit' });
						} else {
							notifyDisposeExitFailure(rollbackFailureMessage);
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
				notifyFailure(failureMessage, {
					commandKind: durableExit ? 'exit' : commandKind,
				});
			} else {
				notifyDisposeExitFailure(failureMessage);
			}
			return false;
		}
		return true;
	};

	const runScrollCommands = ({
		commands,
		operationGeneration,
	}: {
		commands: WorkmuxScrollbackPageCommand[];
		operationGeneration: number;
	}) => {
		const shellCommands = mergeWorkmuxScrollbackPageCommands(commands).map(
			(command) =>
				buildWorkmuxAppScrollPageCommand(
					command.sessionName,
					command.direction,
					command.count,
				),
		);
		return runCommands({
			commands: shellCommands.length ? [shellCommands.join(' && ')] : [],
			commandKind: 'scroll',
			operationGeneration,
		});
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
		enqueueScrollBatch: (commands: WorkmuxScrollbackPageCommand[]) => {
			if (closed || disposed) return Promise.resolve(false);
			if (commands.length === 0) return Promise.resolve(true);
			const promise = new Promise<boolean>((resolve) => {
				if (pendingScrollBatch && pendingScrollBatch.generation === workGeneration) {
					pendingScrollBatch.commands =
						coalesceWorkmuxScrollbackPendingPageCommands([
							...pendingScrollBatch.commands,
							...commands,
						]);
					pendingScrollBatch.resolvers.push(resolve);
					return;
				}
				clearPendingScrollBatches();
				pendingScrollBatch = {
					commands: mergeWorkmuxScrollbackPageCommands(commands),
					generation: workGeneration,
					resolvers: [resolve],
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
					let success = false;
					try {
						success = await runScrollCommands({
							commands: batch.commands,
							operationGeneration: batch.generation,
						});
					} finally {
						for (const resolve of batch.resolvers) {
							resolve(success);
						}
					}
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
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	remoteCopyModeExitCommand?: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}): Promise<boolean> | null {
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	return (
		commandExecutor?.reset({
			exitCommand: remoteCopyModeExitCommand,
			failurePolicy,
		}) ?? null
	);
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

export function formatWorkmuxScrollbackCommandFailureMessage(result: {
	success: boolean;
	output: string;
	error?: string;
}): string | null {
	if (result.success) return null;
	return formatWorkmuxAppBoundaryFailureMessage(
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

function isValidScrollbackBatchEvent(event: {
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

export type WorkmuxScrollbackLiveInputSendPlan = {
	segments: Uint8Array<ArrayBuffer>[];
	interSegmentDelayMs?: number;
	clearScrollback: boolean;
};

export type WorkmuxScrollbackLiveInputCleanupBarrier = {
	current: () => Promise<boolean> | null;
	track: (cleanup?: Promise<boolean> | null) => Promise<boolean> | null;
};

export function createWorkmuxScrollbackLiveInputCleanupBarrier(): WorkmuxScrollbackLiveInputCleanupBarrier {
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

export function registerWorkmuxScrollbackLiveInputCleanup(
	barrier: WorkmuxScrollbackLiveInputCleanupBarrier,
	cleanup?: Promise<boolean> | null,
): Promise<boolean> | null {
	return barrier.track(cleanup);
}

export function resolveWorkmuxScrollbackLiveInputCleanup({
	clearScrollback,
	currentCleanup,
	startCleanup,
}: {
	clearScrollback: boolean;
	currentCleanup?: Promise<boolean> | null;
	startCleanup: () => Promise<boolean> | null;
}): Promise<boolean> | null {
	if (currentCleanup) return currentCleanup;
	return clearScrollback ? startCleanup() : null;
}

export function runWorkmuxScrollbackLiveInputSendPlan({
	plan,
	currentCleanup,
	startCleanup,
	remoteCopyModeActive,
	sendSegments,
	isRequestCurrent = () => true,
}: {
	plan: WorkmuxScrollbackLiveInputSendPlan;
	currentCleanup?: Promise<boolean> | null;
	startCleanup: () => Promise<boolean> | null;
	remoteCopyModeActive: boolean;
	isRequestCurrent?: () => boolean;
	sendSegments: (
		segments: Uint8Array<ArrayBuffer>[],
		options?: { interSegmentDelayMs?: number },
	) => void | Promise<unknown> | undefined;
}): Promise<boolean> | null {
	const cleanupBarrier = resolveWorkmuxScrollbackLiveInputCleanup({
		clearScrollback: plan.clearScrollback,
		currentCleanup,
		startCleanup,
	});
	if (!plan.segments.length) return cleanupBarrier ?? null;

	const send = () =>
		sendSegments(plan.segments, {
			interSegmentDelayMs: plan.interSegmentDelayMs,
		});
	if (!cleanupBarrier && remoteCopyModeActive) return null;
	if (cleanupBarrier) {
		void cleanupBarrier
			.then((exited) => {
				if (exited && isRequestCurrent()) {
					void Promise.resolve(send()).catch(() => {});
				}
			})
			.catch(() => {});
		return cleanupBarrier;
	}
	if (!isRequestCurrent()) return null;
	void Promise.resolve(send()).catch(() => {});
	return null;
}

export function registerTmuxScrollbackRemoteCopyModeExitCleanup({
	barrier,
	cleanup,
	remoteCopyModeActiveRef,
	remoteCopyModeWasActive = remoteCopyModeActiveRef.current,
	markRemoteCopyModeActiveOnFailedCleanup = false,
	cleanupGeneration,
}: {
	barrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	cleanup?: Promise<boolean> | null;
	remoteCopyModeActiveRef: { current: boolean };
	remoteCopyModeWasActive?: boolean;
	markRemoteCopyModeActiveOnFailedCleanup?: boolean;
	cleanupGeneration?: { current: number };
}): Promise<boolean> | null {
	const generation = cleanupGeneration?.current;
	const trackedCleanup = registerWorkmuxScrollbackLiveInputCleanup(
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

function runTmuxScrollbackRemoteCopyModeCleanupForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	targetName,
	cleanupOperation,
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	targetName: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
	cleanupOperation: (options: {
		remoteCopyModeWasActive: boolean;
		remoteCopyModeExitCommand?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => Promise<boolean> | null;
}): Promise<boolean> | null {
	const remoteCopyModeWasActive = remoteCopyModeActiveRef.current;
	const remoteCopyModeExitCommand = remoteCopyModeWasActive
		? buildWorkmuxAppScrollExitCommand(targetName)
		: undefined;
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	const cleanup = commandExecutor
		? cleanupOperation({
				remoteCopyModeWasActive,
				remoteCopyModeExitCommand,
				failurePolicy,
			})
		: null;
	return registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup,
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive,
		markRemoteCopyModeActiveOnFailedCleanup: true,
		cleanupGeneration,
	});
}

export function resetTmuxScrollbackRuntimeStateForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	targetName,
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	targetName: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}): Promise<boolean> | null {
	return runTmuxScrollbackRemoteCopyModeCleanupForUiReset({
		lineAccumulator,
		commandExecutor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		cleanupGeneration,
		targetName,
		failurePolicy,
		cleanupOperation: ({ remoteCopyModeExitCommand, failurePolicy }) =>
			resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor,
				remoteCopyModeExitCommand,
				failurePolicy,
			}),
	});
}

export function disposeTmuxScrollbackRuntimeStateForUiReset({
	lineAccumulator,
	commandExecutor,
	cleanupBarrier,
	remoteCopyModeActiveRef,
	cleanupGeneration,
	targetName,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	cleanupBarrier: WorkmuxScrollbackLiveInputCleanupBarrier;
	remoteCopyModeActiveRef: { current: boolean };
	cleanupGeneration?: { current: number };
	targetName: string;
}): Promise<boolean> | null {
	return runTmuxScrollbackRemoteCopyModeCleanupForUiReset({
		lineAccumulator,
		commandExecutor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		cleanupGeneration,
		targetName,
		cleanupOperation: ({ remoteCopyModeExitCommand }) =>
			commandExecutor?.dispose({
				exitCommand: remoteCopyModeExitCommand,
			}) ?? null,
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

export type TmuxScrollbackEnterRequestResolution =
	| { action: 'enter' }
	| { action: 'clear-local-ui' }
	| { action: 'ignore' };

export function resolveTmuxScrollbackEnterRequest({
	isAppActive,
	instanceId,
	currentInstanceId,
}: {
	isAppActive: boolean;
	instanceId: string;
	currentInstanceId?: string | null;
}): TmuxScrollbackEnterRequestResolution {
	if (currentInstanceId && instanceId !== currentInstanceId) {
		return { action: 'ignore' };
	}
	if (!isAppActive) return { action: 'clear-local-ui' };
	return { action: 'enter' };
}

export async function handleTmuxScrollbackEnterRequested({
	event,
	isAppActive,
	currentInstanceId,
	shellAvailable,
	selectionModeEnabled,
	tmuxEnabled,
	connectionAvailable,
	targetName,
	commandExecutor,
	remoteCopyModeActiveRef,
	remoteCopyModeGenerationRef,
	clearLocalScrollbackUiState,
	sendScrollbackEnterAck,
	isRequestCurrent = () => true,
}: {
	event: { instanceId: string; requestId: number };
	isAppActive: boolean;
	currentInstanceId?: string | null;
	shellAvailable: boolean;
	selectionModeEnabled: boolean;
	tmuxEnabled: boolean;
	connectionAvailable: boolean;
	targetName: string;
	commandExecutor: WorkmuxScrollbackCommandExecutor;
	remoteCopyModeActiveRef: { current: boolean };
	remoteCopyModeGenerationRef: { current: number };
	clearLocalScrollbackUiState: () => void;
	sendScrollbackEnterAck: (requestId: number, instanceId: string) => void;
	isRequestCurrent?: () => boolean;
}): Promise<void> {
	const requestResolution = resolveTmuxScrollbackEnterRequest({
		isAppActive,
		instanceId: event.instanceId,
		currentInstanceId,
	});
	if (requestResolution.action === 'ignore') return;
	if (requestResolution.action === 'clear-local-ui') {
		clearLocalScrollbackUiState();
		return;
	}

	if (
		!shellAvailable ||
		selectionModeEnabled ||
		!tmuxEnabled ||
		!connectionAvailable
	) {
		clearLocalScrollbackUiState();
		return;
	}

	const command = buildWorkmuxAppScrollEnterCommand(targetName);
	const entered = await commandExecutor.runEnterCommand(command, {
		rollbackExitCommand: buildWorkmuxAppScrollExitCommand(targetName),
	});
	if (!isRequestCurrent()) return;
	if (!entered) {
		clearLocalScrollbackUiState();
		return;
	}
	remoteCopyModeGenerationRef.current += 1;
	remoteCopyModeActiveRef.current = true;
	sendScrollbackEnterAck(event.requestId, event.instanceId);
}

export function handleTmuxScrollbackBatchEvent({
	event,
	shellAvailable,
	currentInstanceId,
	selectionModeEnabled,
	tmuxEnabled,
	connectionAvailable,
	scrollbackActive,
	targetName,
	lineAccumulator,
	enqueueScrollBatch,
}: {
	event: {
		direction: WorkmuxScrollDirection;
		pages: number;
		lines: number;
		pageStep: number;
		instanceId: string;
	};
	shellAvailable: boolean;
	currentInstanceId?: string | null;
	selectionModeEnabled: boolean;
	tmuxEnabled: boolean;
	connectionAvailable: boolean;
	scrollbackActive: boolean;
	targetName: string;
	lineAccumulator: TmuxScrollbackLineAccumulator;
	enqueueScrollBatch: (
		commands: WorkmuxScrollbackPageCommand[],
	) => Promise<boolean>;
}): boolean {
	if (!shellAvailable) return false;
	if (currentInstanceId && event.instanceId !== currentInstanceId) return false;
	if (selectionModeEnabled) return false;
	if (!tmuxEnabled || !connectionAvailable) return false;
	if (!scrollbackActive) return false;
	if (!isValidScrollbackBatchEvent(event)) return false;

	const commands = accumulateWorkmuxScrollbackBatchCommands({
		sessionName: targetName,
		direction: event.direction,
		pages: event.pages,
		lines: event.lines,
		linesPerPage: event.pageStep,
		lineAccumulator,
	});
	if (commands.length === 0) return false;
	void enqueueScrollBatch(commands);
	return true;
}

export function buildWorkmuxScrollbackLiveInputSendPlan({
	scrollbackActive,
	payloadSegments,
	scrollbackExitKeyPayload,
	interSegmentDelayMs,
	scrollbackExitDelayMs,
}: {
	scrollbackActive: boolean;
	payloadSegments: Uint8Array<ArrayBuffer>[];
	scrollbackExitKeyPayload?: Uint8Array<ArrayBuffer>;
	interSegmentDelayMs?: number;
	scrollbackExitDelayMs: number;
}): WorkmuxScrollbackLiveInputSendPlan {
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

	const isExitKeyOnlyPayload =
		scrollbackExitKeyPayload != null &&
		nonEmptyPayloadSegments.length === 1 &&
		bytesEqual(nonEmptyPayloadSegments[0], scrollbackExitKeyPayload);

	return {
		segments: isExitKeyOnlyPayload ? [] : nonEmptyPayloadSegments,
		interSegmentDelayMs: scrollbackExitDelayMs,
		clearScrollback: true,
	};
}

function bytesEqual(
	a: Uint8Array<ArrayBuffer> | undefined,
	b: Uint8Array<ArrayBuffer>,
): boolean {
	if (!a || a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) {
		if (a[index] !== b[index]) return false;
	}
	return true;
}
