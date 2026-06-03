import {
	buildWorkmuxAppScrollPageCommand,
	formatWorkmuxAppBoundaryFailureMessage,
} from './workmux-app-commands';
import {
	coalesceWorkmuxScrollbackPendingPageCommands,
	mergeWorkmuxScrollbackPageCommands,
	type WorkmuxScrollbackPageCommand,
} from './workmux-scrollback-batch';

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
