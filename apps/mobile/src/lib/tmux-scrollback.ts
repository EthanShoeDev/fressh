import {
	buildWorkmuxAppScrollEnterCommand,
	buildWorkmuxAppScrollExitCommand,
	type WorkmuxScrollDirection,
} from './workmux-app-commands';
import {
	accumulateWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	isValidScrollbackBatchEvent,
	type TmuxScrollbackLineAccumulator,
	type WorkmuxScrollbackPageCommand,
} from './workmux-scrollback-batch';
import {
	type WorkmuxScrollbackCommandExecutor,
	type WorkmuxScrollbackFailurePolicy,
} from './workmux-scrollback-executor';
import {
	registerWorkmuxScrollbackLiveInputCleanup,
	type WorkmuxScrollbackLiveInputCleanupBarrier,
} from './workmux-scrollback-live-input';

export {
	accumulateWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createTmuxScrollbackLineAccumulator,
	mergeWorkmuxScrollbackPageCommands,
	TMUX_SCROLLBACK_EXECUTOR_MAX_PENDING_PAGES,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
	type TmuxScrollbackLineAccumulator,
	type WorkmuxScrollbackPageCommand,
} from './workmux-scrollback-batch';
export {
	createTmuxScrollbackLocalExitRequest,
	registerTmuxScrollbackLocalExitRequest,
	resetTmuxScrollbackLocalExitRequests,
	TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT,
} from './tmux-scrollback-local-exit';
export {
	buildWorkmuxScrollbackLiveInputSendPlan,
	createWorkmuxScrollbackLiveInputCleanupBarrier,
	registerWorkmuxScrollbackLiveInputCleanup,
	resolveWorkmuxScrollbackLiveInputCleanup,
	runWorkmuxScrollbackLiveInputSendPlan,
	type WorkmuxScrollbackLiveInputCleanupBarrier,
	type WorkmuxScrollbackLiveInputSendPlan,
} from './workmux-scrollback-live-input';
export {
	createWorkmuxScrollbackCommandExecutor,
	formatWorkmuxScrollbackCommandFailureMessage,
	type WorkmuxScrollbackCommandExecutor,
	type WorkmuxScrollbackCommandResult,
	type WorkmuxScrollbackFailureContext,
	type WorkmuxScrollbackFailurePolicy,
} from './workmux-scrollback-executor';

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
