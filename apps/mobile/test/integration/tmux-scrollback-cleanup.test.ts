import assert from 'node:assert/strict';
import test from 'node:test';
import {
	disposeTmuxScrollbackRuntimeStateForUiReset,
	handleTmuxScrollbackEnterRequested,
	resetTmuxScrollbackRuntimeState,
	resetTmuxScrollbackRuntimeStateForUiReset,
	resolveTmuxScrollbackEnterRequest,
	shouldRunTmuxScrollbackRemoteResetForModeChange,
} from '../../src/lib/tmux-scrollback';
import {
	createTmuxScrollbackLocalExitRequest,
	registerTmuxScrollbackLocalExitRequest,
	resetTmuxScrollbackLocalExitRequests,
	TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT,
} from '../../src/lib/tmux-scrollback-local-exit';
import { type WorkmuxControlChannel } from '../../src/lib/workmux-control-channel';
import { createTmuxScrollbackLineAccumulator } from '../../src/lib/workmux-scrollback-batch';
import {
	createWorkmuxScrollbackCommandExecutor as createBaseWorkmuxScrollbackCommandExecutor,
	type WorkmuxScrollbackCommandResult,
} from '../../src/lib/workmux-scrollback-executor';
import {
	buildWorkmuxScrollbackLiveInputSendPlan,
	createWorkmuxScrollbackLiveInputCleanupBarrier,
	registerWorkmuxScrollbackLiveInputCleanup,
	resolveWorkmuxScrollbackLiveInputCleanup,
} from '../../src/lib/workmux-scrollback-live-input';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));
const enterText = (sessionName = 'main') => `enter:${sessionName}`;
const exitText = (sessionName = 'main') => `exit:${sessionName}`;
const workmuxScrollExitCommand = exitText();
function createRecordingScrollTransport(
	executeCommand: (command: string) => Promise<WorkmuxScrollbackCommandResult>,
): WorkmuxControlChannel['scroll'] {
	return {
		enter: ({ sessionName }) => executeCommand(enterText(sessionName)),
		move: ({ sessionName, direction, unit, count }) =>
			executeCommand(`move:${sessionName}:${direction}:${unit}:${count}`),
		exit: ({ sessionName }) => executeCommand(exitText(sessionName)),
	};
}

function createWorkmuxScrollbackCommandExecutor({
	executeCommand,
	...options
}: Omit<
	Parameters<typeof createBaseWorkmuxScrollbackCommandExecutor>[0],
	'scrollTransport'
> & {
	executeCommand: (command: string) => Promise<WorkmuxScrollbackCommandResult>;
}) {
	return createBaseWorkmuxScrollbackCommandExecutor({
		...options,
		scrollTransport: createRecordingScrollTransport(executeCommand),
	});
}
const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

void test('failed active Workmux scroll exit clears local UI without recursive exit retry', async () => {
	const commands: string[] = [];
	const failures: string[] = [];
	const sentPayloads: number[][] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	let localScrollbackActive = true;
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === workmuxScrollExitCommand) {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message, context) => {
			failures.push(`${context.commandKind}:${message}`);
			if (context.commandKind === 'exit') {
				localScrollbackActive = false;
				return;
			}
			void resetTmuxScrollbackRuntimeStateForUiReset({
				lineAccumulator,
				commandExecutor: executor,
				cleanupBarrier,
				remoteCopyModeActiveRef,
				targetName: 'main',
			});
		},
	});

	assert.equal(await executor.runEnterCommand('main'), true);
	remoteCopyModeActiveRef.current = true;

	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		targetName: 'main',
	});

	assert.notEqual(cleanup, null);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, [enterText(), workmuxScrollExitCommand]);
	assert.deepEqual(failures, ['exit:exit failed']);
	assert.equal(localScrollbackActive, false);
	assert.equal(remoteCopyModeActiveRef.current, true);
	assert.equal(cleanupBarrier.current(), null);

	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: localScrollbackActive || remoteCopyModeActiveRef.current,
		payloadSegments: [bytes([0x70])],
		scrollbackExitDelayMs: 10,
	});
	const retryCleanup = plan.clearScrollback
		? resetTmuxScrollbackRuntimeStateForUiReset({
				lineAccumulator,
				commandExecutor: executor,
				cleanupBarrier,
				remoteCopyModeActiveRef,
				targetName: 'main',
			})
		: cleanupBarrier.current();

	if (retryCleanup) {
		await retryCleanup.then((exited) => {
			if (exited) sentPayloads.push(...segmentValues(plan.segments));
		});
	} else if (!remoteCopyModeActiveRef.current) {
		sentPayloads.push(...segmentValues(plan.segments));
	}

	assert.deepEqual(commands, [
		enterText(),
		workmuxScrollExitCommand,
		workmuxScrollExitCommand,
	]);
	assert.deepEqual(sentPayloads, []);
	assert.equal(remoteCopyModeActiveRef.current, true);
});

void test('inactive Workmux scroll enter cleanup suppresses canceled enter alert', async () => {
	const commandBlock = deferred<void>();
	const failures: string[] = [];
	const disposeFailures: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			if (command === enterText()) {
				await commandBlock.promise;
				return { success: false, output: '', error: 'enter failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();

	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		targetName: 'main',
		failurePolicy: 'suppress',
	});

	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	assert.deepEqual(failures, []);
	assert.deepEqual(disposeFailures, ['enter failed']);
});

void test('component disposal UI reset clears line accumulator and disposes executor', async () => {
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: true };
	const cleanupGeneration = { current: 0 };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	lineAccumulator.direction = 'up';
	lineAccumulator.lines = 12;

	const cleanup = disposeTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		cleanupGeneration,
		targetName: 'main',
	});

	assert.notEqual(cleanup, null);
	assert.deepEqual(lineAccumulator, { direction: null, lines: 0 });
	assert.equal(await cleanup, true);
	assert.deepEqual(commands, [workmuxScrollExitCommand]);
	assert.equal(remoteCopyModeActiveRef.current, false);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
});

void test('failed UI reset exit keeps remote copy mode active and blocks later live input', async () => {
	const commands: string[] = [];
	const sentPayloads: number[][] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === workmuxScrollExitCommand) {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	assert.equal(await executor.runEnterCommand('main'), true);
	remoteCopyModeActiveRef.current = true;

	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		targetName: 'main',
	});

	assert.notEqual(cleanup, null);
	assert.equal(await cleanup, false);
	assert.equal(cleanupBarrier.current(), null);
	assert.equal(remoteCopyModeActiveRef.current, true);

	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive: remoteCopyModeActiveRef.current,
		payloadSegments: [bytes([0x70])],
		scrollbackExitDelayMs: 10,
	});
	const retryCleanup = plan.clearScrollback
		? resetTmuxScrollbackRuntimeStateForUiReset({
				lineAccumulator,
				commandExecutor: executor,
				cleanupBarrier,
				remoteCopyModeActiveRef,
				targetName: 'main',
			})
		: cleanupBarrier.current();

	if (retryCleanup) {
		await retryCleanup.then((exited) => {
			if (exited) sentPayloads.push(...segmentValues(plan.segments));
		});
	} else if (!remoteCopyModeActiveRef.current) {
		sentPayloads.push(...segmentValues(plan.segments));
	}

	assert.deepEqual(sentPayloads, []);
	assert.equal(remoteCopyModeActiveRef.current, true);
	assert.deepEqual(commands, [
		enterText(),
		workmuxScrollExitCommand,
		workmuxScrollExitCommand,
	]);
});

void test('live input waits for pending app scroll enter rollback before sending primary payload', async () => {
	const enterBlock = deferred<void>();
	const exitBlock = deferred<void>();
	const commands: string[] = [];
	const sentPayloads: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await enterBlock.promise;
			if (command === exitText()) await exitBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const cleanup = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	assert.notEqual(cleanup, null);
	const sendAfterCleanup = cleanup?.then((exited) => {
		if (exited) sentPayloads.push('payload');
	});

	enterBlock.resolve(undefined);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.deepEqual(sentPayloads, []);
	exitBlock.resolve(undefined);

	assert.equal(await enter, false);
	await sendAfterCleanup;
	assert.deepEqual(sentPayloads, ['payload']);
	assert.deepEqual(commands, [enterText(), exitText()]);
});

void test('pending enter rollback exit failure notifies active reset policy and blocks live input continuation', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const failures: string[] = [];
	const sentPayloads: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await enterBlock.promise;
			if (command === exitText()) {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const cleanup = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	assert.notEqual(cleanup, null);
	const sendAfterCleanup = cleanup?.then((exited) => {
		if (exited) sentPayloads.push('payload');
	});

	enterBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	await sendAfterCleanup;
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.deepEqual(failures, ['exit failed']);
	assert.deepEqual(sentPayloads, []);
});

void test('pending enter rollback exit failure marks remote copy mode active for UI reset', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await enterBlock.promise;
			if (command === exitText()) {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		targetName: 'main',
	});

	assert.notEqual(cleanup, null);
	enterBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.equal(remoteCopyModeActiveRef.current, true);
});

void test('multiple live input events wait behind the same pending scrollback cleanup barrier', async () => {
	const cleanupBlock = deferred<void>();
	const barrierRef = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const sentPayloads: string[] = [];
	let scrollbackActive = true;

	const queueLiveInput = (
		payload: string,
		cleanup: Promise<boolean> | null = null,
	) => {
		const plan = buildWorkmuxScrollbackLiveInputSendPlan({
			scrollbackActive,
			payloadSegments: [bytes([payload.charCodeAt(0)])],
			scrollbackExitDelayMs: 10,
		});
		if (plan.clearScrollback) scrollbackActive = false;
		const barrier = barrierRef.track(cleanup);
		void (barrier ?? Promise.resolve(true)).then((exited) => {
			if (exited) sentPayloads.push(payload);
		});
	};

	const cleanup = cleanupBlock.promise.then(() => true);
	queueLiveInput('a', cleanup);
	queueLiveInput('b');

	await Promise.resolve();
	assert.deepEqual(sentPayloads, []);
	cleanupBlock.resolve(undefined);
	await cleanup;
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(sentPayloads.join(''), 'ab');
	assert.equal(barrierRef.current(), null);
});

void test('live input joins current cleanup barrier before starting another remote exit', async () => {
	const cleanupBlock = deferred<void>();
	let cleanupStarts = 0;
	const currentCleanup = cleanupBlock.promise.then(() => true);
	const sentPayloads: string[] = [];

	const queueLiveInput = (payload: string) => {
		const plan = buildWorkmuxScrollbackLiveInputSendPlan({
			scrollbackActive: true,
			payloadSegments: [bytes([payload.charCodeAt(0)])],
			scrollbackExitDelayMs: 10,
		});
		const cleanup = resolveWorkmuxScrollbackLiveInputCleanup({
			clearScrollback: plan.clearScrollback,
			currentCleanup,
			startCleanup: () => {
				cleanupStarts += 1;
				return Promise.resolve(true);
			},
		});
		void cleanup?.then((exited) => {
			if (exited) sentPayloads.push(payload);
		});
	};

	queueLiveInput('a');
	queueLiveInput('b');

	await Promise.resolve();
	assert.deepEqual(sentPayloads, []);
	assert.equal(cleanupStarts, 0);
	cleanupBlock.resolve(undefined);
	await currentCleanup;
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepEqual(sentPayloads, ['a', 'b']);
});

void test('live input waits for externally initiated inactive cleanup barrier before sending primary payload', async () => {
	const cleanupBlock = deferred<void>();
	const barrierRef = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const sentPayloads: string[] = [];
	let scrollbackActive = true;

	const externalCleanup = cleanupBlock.promise.then(() => true);
	scrollbackActive = false;
	void registerWorkmuxScrollbackLiveInputCleanup(barrierRef, externalCleanup);

	const plan = buildWorkmuxScrollbackLiveInputSendPlan({
		scrollbackActive,
		payloadSegments: [bytes([0x70])],
		scrollbackExitDelayMs: 10,
	});
	const barrier = barrierRef.track(
		plan.clearScrollback ? externalCleanup : null,
	);
	void (barrier ?? Promise.resolve(true)).then((exited) => {
		if (exited) sentPayloads.push('payload');
	});

	await Promise.resolve();
	assert.deepEqual(sentPayloads, []);
	cleanupBlock.resolve(undefined);
	await externalCleanup;
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepEqual(sentPayloads, ['payload']);
	assert.equal(barrierRef.current(), null);
});

void test('runtime reset clears scrollback and waits for pending enter rollback', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await enterBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const cleanup = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});

	assert.notEqual(cleanup, null);
	enterBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, true);
	assert.deepEqual(commands, [enterText(), exitText()]);
});

void test('Workmux scrollback enter request resolution clears inactive current instance only', () => {
	assert.deepEqual(
		resolveTmuxScrollbackEnterRequest({
			isAppActive: true,
			instanceId: 'current',
			currentInstanceId: 'current',
		}),
		{ action: 'enter' },
	);
	assert.deepEqual(
		resolveTmuxScrollbackEnterRequest({
			isAppActive: false,
			instanceId: 'current',
			currentInstanceId: 'current',
		}),
		{ action: 'clear-local-ui' },
	);
	assert.deepEqual(
		resolveTmuxScrollbackEnterRequest({
			isAppActive: false,
			instanceId: 'stale',
			currentInstanceId: 'current',
		}),
		{ action: 'ignore' },
	);
});

void test('locally requested WebView scrollback inactive event does not run remote reset', () => {
	const localExitRequestIds = new Set([7]);

	assert.equal(
		shouldRunTmuxScrollbackRemoteResetForModeChange({
			active: false,
			requestId: 7,
			localExitRequestIds,
		}),
		false,
	);
	assert.deepEqual(Array.from(localExitRequestIds), []);
	assert.equal(
		shouldRunTmuxScrollbackRemoteResetForModeChange({
			active: false,
			requestId: 8,
			localExitRequestIds,
		}),
		true,
	);
	assert.equal(
		shouldRunTmuxScrollbackRemoteResetForModeChange({
			active: true,
			requestId: 8,
			localExitRequestIds,
		}),
		false,
	);
});

void test('local scrollback exit request tracking is bounded and resettable', () => {
	const localExitRequestIds = new Set<number>();

	for (
		let requestId = 1;
		requestId <= TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT + 2;
		requestId += 1
	) {
		registerTmuxScrollbackLocalExitRequest({
			requestIds: localExitRequestIds,
			requestId,
		});
	}

	assert.equal(
		localExitRequestIds.size,
		TMUX_SCROLLBACK_LOCAL_EXIT_REQUEST_ID_LIMIT,
	);
	assert.equal(localExitRequestIds.has(1), false);
	assert.equal(localExitRequestIds.has(2), false);
	assert.equal(localExitRequestIds.has(3), true);

	resetTmuxScrollbackLocalExitRequests(localExitRequestIds);

	assert.deepEqual(Array.from(localExitRequestIds), []);
});

void test('local scrollback exit request payload includes current instance', () => {
	const localExitRequestIds = new Set<number>();
	const request = createTmuxScrollbackLocalExitRequest({
		requestIds: localExitRequestIds,
		requestId: 12,
		instanceId: 'current',
	});

	assert.deepEqual(request.message, {
		requestId: 12,
		instanceId: 'current',
	});
	assert.equal(localExitRequestIds.has(12), true);
});

void test('local scrollback exit request reset makes stale exits remote-owned again', () => {
	const localExitRequestIds = new Set<number>();

	registerTmuxScrollbackLocalExitRequest({
		requestIds: localExitRequestIds,
		requestId: 7,
	});

	resetTmuxScrollbackLocalExitRequests(localExitRequestIds);

	assert.equal(
		shouldRunTmuxScrollbackRemoteResetForModeChange({
			active: false,
			requestId: 7,
			localExitRequestIds,
		}),
		true,
	);
});

void test('scrollback enter request adapter acks only after Workmux enter succeeds', async () => {
	const commands: string[] = [];
	const acks: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});
	const remoteCopyModeActiveRef = { current: false };
	const remoteCopyModeGenerationRef = { current: 0 };

	await handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'current', requestId: 42 },
		isAppActive: true,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef,
		remoteCopyModeGenerationRef,
		clearLocalScrollbackUiState: () => acks.push('clear'),
		sendScrollbackEnterAck: (requestId, instanceId) =>
			acks.push(`${requestId}:${instanceId}`),
	});

	assert.deepEqual(commands, [enterText()]);
	assert.deepEqual(acks, ['42:current']);
	assert.equal(remoteCopyModeActiveRef.current, true);
	assert.equal(remoteCopyModeGenerationRef.current, 1);
});

void test('scrollback enter request adapter skips ack on failed Workmux enter', async () => {
	const commands: string[] = [];
	const acks: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: false, output: '', error: 'mdev: command not found' };
		},
		onFailure: () => {},
	});

	await handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'current', requestId: 42 },
		isAppActive: true,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef: { current: false },
		remoteCopyModeGenerationRef: { current: 0 },
		clearLocalScrollbackUiState: () => acks.push('clear'),
		sendScrollbackEnterAck: (requestId, instanceId) =>
			acks.push(`${requestId}:${instanceId}`),
	});

	assert.deepEqual(commands, [enterText()]);
	assert.deepEqual(acks, ['clear']);
});

void test('scrollback enter request adapter clears local UI when enter is canceled before ack', async () => {
	const commandStarted = deferred<void>();
	const commandCanFinish = deferred<void>();
	const events: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			events.push(`command:${command}`);
			commandStarted.resolve();
			await commandCanFinish.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'current', requestId: 42 },
		isAppActive: true,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef: { current: false },
		remoteCopyModeGenerationRef: { current: 0 },
		clearLocalScrollbackUiState: () => events.push('clear'),
		sendScrollbackEnterAck: () => events.push('ack'),
	});

	await commandStarted.promise;
	void executor.dispose();
	commandCanFinish.resolve();
	await enter;

	assert.deepEqual(events, [
		`command:${enterText()}`,
		`command:${exitText()}`,
		'clear',
	]);
});

void test('scrollback enter request adapter clears inactive current instance and ignores stale instance', async () => {
	const events: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			events.push(`command:${command}`);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	await handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'current', requestId: 1 },
		isAppActive: false,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef: { current: false },
		remoteCopyModeGenerationRef: { current: 0 },
		clearLocalScrollbackUiState: () => events.push('clear'),
		sendScrollbackEnterAck: () => events.push('ack'),
	});
	await handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'stale', requestId: 2 },
		isAppActive: false,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef: { current: false },
		remoteCopyModeGenerationRef: { current: 0 },
		clearLocalScrollbackUiState: () => events.push('stale-clear'),
		sendScrollbackEnterAck: () => events.push('stale-ack'),
	});

	assert.deepEqual(events, ['clear']);
});

void test('scrollback enter request adapter clears current guarded events before Workmux command', async () => {
	const commands: string[] = [];
	const acks: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});
	const runEnter = (
		overrides: Partial<
			Parameters<typeof handleTmuxScrollbackEnterRequested>[0]
		>,
	) =>
		handleTmuxScrollbackEnterRequested({
			event: { instanceId: 'current', requestId: 42 },
			isAppActive: true,
			currentInstanceId: 'current',
			shellAvailable: true,
			selectionModeEnabled: false,
			tmuxEnabled: true,
			connectionAvailable: true,
			targetName: 'main',
			commandExecutor: executor,
			remoteCopyModeActiveRef: { current: false },
			remoteCopyModeGenerationRef: { current: 0 },
			clearLocalScrollbackUiState: () => acks.push('clear'),
			sendScrollbackEnterAck: (requestId, instanceId) =>
				acks.push(`${requestId}:${instanceId}`),
			...overrides,
		});

	for (const rejected of [
		{ shellAvailable: false },
		{ selectionModeEnabled: true },
		{ tmuxEnabled: false },
		{ connectionAvailable: false },
	]) {
		await runEnter(rejected);
	}

	assert.deepEqual(commands, []);
	assert.deepEqual(acks, ['clear', 'clear', 'clear', 'clear']);
});

void test('scrollback enter request adapter ignores stale guarded events', async () => {
	const commands: string[] = [];
	const events: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	await handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'stale', requestId: 42 },
		isAppActive: true,
		currentInstanceId: 'current',
		shellAvailable: false,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef: { current: false },
		remoteCopyModeGenerationRef: { current: 0 },
		clearLocalScrollbackUiState: () => events.push('clear'),
		sendScrollbackEnterAck: () => events.push('ack'),
	});

	assert.deepEqual(commands, []);
	assert.deepEqual(events, []);
});

void test('scrollback enter request adapter suppresses async completion after disposal', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const events: string[] = [];
	const remoteCopyModeActiveRef = { current: false };
	const remoteCopyModeGenerationRef = { current: 0 };
	let requestCurrent = true;
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			await enterBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'current', requestId: 42 },
		isAppActive: true,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef,
		remoteCopyModeGenerationRef,
		clearLocalScrollbackUiState: () => events.push('clear'),
		sendScrollbackEnterAck: () => events.push('ack'),
		isRequestCurrent: () => requestCurrent,
	});
	await Promise.resolve();

	requestCurrent = false;
	void executor.dispose();
	enterBlock.resolve(undefined);
	await enter;

	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.deepEqual(events, []);
	assert.equal(remoteCopyModeActiveRef.current, false);
	assert.equal(remoteCopyModeGenerationRef.current, 0);
});

void test('scrollback enter request adapter suppresses async completion after focus invalidation', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const events: string[] = [];
	const remoteCopyModeActiveRef = { current: false };
	const remoteCopyModeGenerationRef = { current: 0 };
	let requestCurrent = true;
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			await enterBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = handleTmuxScrollbackEnterRequested({
		event: { instanceId: 'current', requestId: 42 },
		isAppActive: true,
		currentInstanceId: 'current',
		shellAvailable: true,
		selectionModeEnabled: false,
		tmuxEnabled: true,
		connectionAvailable: true,
		targetName: 'main',
		commandExecutor: executor,
		remoteCopyModeActiveRef,
		remoteCopyModeGenerationRef,
		clearLocalScrollbackUiState: () => events.push('clear'),
		sendScrollbackEnterAck: () => events.push('ack'),
		isRequestCurrent: () => requestCurrent,
	});
	await Promise.resolve();

	requestCurrent = false;
	enterBlock.resolve(undefined);
	await enter;

	assert.deepEqual(commands, [enterText()]);
	assert.deepEqual(events, []);
	assert.equal(remoteCopyModeActiveRef.current, false);
	assert.equal(remoteCopyModeGenerationRef.current, 0);
});
