import { type WorkmuxScrollDirection } from './workmux-app-commands';
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
import { type ScrollTraceSink } from './scroll-trace';
import {
	registerWorkmuxScrollbackLiveInputCleanup,
	type WorkmuxScrollbackLiveInputCleanupBarrier,
} from './workmux-scrollback-live-input';

export function resetTmuxScrollbackRuntimeState({
	lineAccumulator,
	commandExecutor,
	targetName,
	failurePolicy,
}: {
	lineAccumulator: TmuxScrollbackLineAccumulator;
	commandExecutor?: WorkmuxScrollbackCommandExecutor | null;
	targetName?: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}): Promise<boolean> | null {
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	return (
		commandExecutor?.reset({
			targetName,
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
		targetName?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => Promise<boolean> | null;
}): Promise<boolean> | null {
	const remoteCopyModeWasActive = remoteCopyModeActiveRef.current;
	const cleanupTargetName = remoteCopyModeWasActive ? targetName : undefined;
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	const cleanup = commandExecutor
		? cleanupOperation({
				remoteCopyModeWasActive,
				targetName: cleanupTargetName,
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
		cleanupOperation: ({ targetName, failurePolicy }) =>
			resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor,
				targetName,
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
		cleanupOperation: ({ targetName }) =>
			commandExecutor?.dispose({
				targetName,
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

type TmuxScrollbackEnterRequestResolution =
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
	trace,
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
	trace?: ScrollTraceSink;
}): Promise<void> {
	trace?.({
		event: 'rn.enter.request',
		requestId: event.requestId,
		instanceId: event.instanceId,
		currentInstanceId,
	});
	const requestResolution = resolveTmuxScrollbackEnterRequest({
		isAppActive,
		instanceId: event.instanceId,
		currentInstanceId,
	});
	if (requestResolution.action === 'ignore') {
		trace?.({
			event: 'rn.enter.dropped',
			reason: 'stale-instance',
			requestId: event.requestId,
			instanceId: event.instanceId,
			currentInstanceId,
		});
		return;
	}
	if (requestResolution.action === 'clear-local-ui') {
		trace?.({
			event: 'rn.enter.dropped',
			reason: 'app-inactive',
			requestId: event.requestId,
			instanceId: event.instanceId,
		});
		clearLocalScrollbackUiState();
		return;
	}

	if (
		!shellAvailable ||
		selectionModeEnabled ||
		!tmuxEnabled ||
		!connectionAvailable
	) {
		trace?.({
			event: 'rn.enter.dropped',
			reason: 'unavailable',
			requestId: event.requestId,
			instanceId: event.instanceId,
			shellAvailable,
			selectionModeEnabled,
			tmuxEnabled,
			connectionAvailable,
		});
		clearLocalScrollbackUiState();
		return;
	}

	trace?.({
		event: 'rn.enter.command',
		requestId: event.requestId,
		instanceId: event.instanceId,
	});
	const entered = await commandExecutor.runEnterCommand(targetName);
	if (!isRequestCurrent()) {
		trace?.({
			event: 'rn.enter.stale-after-command',
			requestId: event.requestId,
			instanceId: event.instanceId,
			entered,
		});
		return;
	}
	if (!entered) {
		trace?.({
			event: 'rn.enter.failed',
			requestId: event.requestId,
			instanceId: event.instanceId,
		});
		clearLocalScrollbackUiState();
		return;
	}
	remoteCopyModeGenerationRef.current += 1;
	remoteCopyModeActiveRef.current = true;
	trace?.({
		event: 'rn.enter.acked',
		requestId: event.requestId,
		instanceId: event.instanceId,
		remoteGeneration: remoteCopyModeGenerationRef.current,
	});
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
	remoteCopyModeActive,
	targetName,
	lineAccumulator,
	enqueueScrollBatch,
	trace,
}: {
	event: {
		direction: WorkmuxScrollDirection;
		pages: number;
		lines: number;
		pageStep: number;
		instanceId: string;
		seq?: number;
		ts?: number;
	};
	shellAvailable: boolean;
	currentInstanceId?: string | null;
	selectionModeEnabled: boolean;
	tmuxEnabled: boolean;
	connectionAvailable: boolean;
	scrollbackActive: boolean;
	remoteCopyModeActive: boolean;
	targetName: string;
	lineAccumulator: TmuxScrollbackLineAccumulator;
	enqueueScrollBatch: (
		commands: WorkmuxScrollbackPageCommand[],
	) => Promise<boolean>;
	trace?: ScrollTraceSink;
}): boolean {
	const traceBatch = (
		traceEvent: 'rn.batch.accepted' | 'rn.batch.dropped',
		extras?: Record<string, unknown>,
	) => {
		trace?.({
			event: traceEvent,
			direction: event.direction,
			pages: event.pages,
			lines: event.lines,
			pageStep: event.pageStep,
			instanceId: event.instanceId,
			seq: event.seq,
			webviewTs: event.ts,
			...extras,
		});
	};
	if (!shellAvailable) {
		traceBatch('rn.batch.dropped', { reason: 'no-shell' });
		return false;
	}
	if (currentInstanceId && event.instanceId !== currentInstanceId) {
		traceBatch('rn.batch.dropped', {
			reason: 'stale-instance',
			currentInstanceId,
		});
		return false;
	}
	if (selectionModeEnabled) {
		traceBatch('rn.batch.dropped', { reason: 'selection' });
		return false;
	}
	if (!tmuxEnabled || !connectionAvailable) {
		traceBatch('rn.batch.dropped', {
			reason: 'disabled-or-disconnected',
			tmuxEnabled,
			connectionAvailable,
		});
		return false;
	}
	if (!scrollbackActive) {
		traceBatch('rn.batch.dropped', { reason: 'local-inactive' });
		return false;
	}
	if (!remoteCopyModeActive) {
		traceBatch('rn.batch.dropped', { reason: 'remote-inactive' });
		return false;
	}
	if (!isValidScrollbackBatchEvent(event)) {
		traceBatch('rn.batch.dropped', { reason: 'invalid' });
		return false;
	}

	const commands = accumulateWorkmuxScrollbackBatchCommands({
		sessionName: targetName,
		direction: event.direction,
		pages: event.pages,
		lines: event.lines,
		linesPerPage: event.pageStep,
		lineAccumulator,
	});
	if (commands.length === 0) {
		traceBatch('rn.batch.dropped', { reason: 'empty' });
		return false;
	}
	traceBatch('rn.batch.accepted', { commandCount: commands.length });
	void enqueueScrollBatch(commands);
	return true;
}
