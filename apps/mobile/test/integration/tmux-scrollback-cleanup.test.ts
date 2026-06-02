
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackLiveInputSendPlan,
	createTmuxScrollbackLiveInputCleanupBarrier,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLineAccumulator,
	disposeTmuxScrollbackRuntimeStateForUiReset,
	handleTmuxScrollbackBatchEvent,
	handleTmuxScrollbackEnterRequested,
	handleTmuxScrollbackInactiveAppStateTransition,
	handleWorkmuxScrollbackCommandFailureActions,
	handleWorkmuxScrollbackDisposeExitFailureActions,
	registerTmuxScrollbackLiveInputCleanup,
	runTmuxScrollbackLiveInputSendPlan,
	resetTmuxScrollbackRuntimeState,
	resetTmuxScrollbackRuntimeStateForUiReset,
	resolveTmuxScrollbackEnterRequest,
	resolveTmuxScrollbackLiveInputCleanup,
	shouldRunTmuxScrollbackRemoteResetForModeChange,
} from '../../src/lib/tmux-scrollback';

const bytes = (values: number[]) => new Uint8Array(values);
const segmentValues = (segments: readonly Uint8Array<ArrayBuffer>[]) =>
	segments.map((segment) => Array.from(segment));
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
	const cleanupBarrier = createTmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	let localScrollbackActive = true;
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'exit') {
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
				remoteCopyModeExitCommand: 'exit',
			});
		},
	});

	assert.equal(
		await executor.runEnterCommand('enter', {
			rollbackExitCommand: 'exit',
		}),
		true,
	);
	remoteCopyModeActiveRef.current = true;

	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(cleanup, null);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.deepEqual(failures, ['exit:exit failed']);
	assert.equal(localScrollbackActive, false);
	assert.equal(remoteCopyModeActiveRef.current, true);
	assert.equal(cleanupBarrier.current(), null);

	const plan = buildTmuxScrollbackLiveInputSendPlan({
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
				remoteCopyModeExitCommand: 'exit',
			})
		: cleanupBarrier.current();

	if (retryCleanup) {
		await retryCleanup.then((exited) => {
			if (exited) sentPayloads.push(...segmentValues(plan.segments));
		});
	} else if (!remoteCopyModeActiveRef.current) {
		sentPayloads.push(...segmentValues(plan.segments));
	}

	assert.deepEqual(commands, ['enter', 'exit', 'exit']);
	assert.deepEqual(sentPayloads, []);
	assert.equal(remoteCopyModeActiveRef.current, true);
});

void test('component disposal UI reset clears line accumulator and disposes executor', async () => {
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createTmuxScrollbackLiveInputCleanupBarrier();
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
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(cleanup, null);
	assert.deepEqual(lineAccumulator, { direction: null, lines: 0 });
	assert.equal(await cleanup, true);
	assert.deepEqual(commands, ['exit']);
	assert.equal(remoteCopyModeActiveRef.current, false);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
});

void test('failed UI reset exit keeps remote copy mode active and blocks later live input', async () => {
	const commands: string[] = [];
	const sentPayloads: number[][] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createTmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'exit') {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	assert.equal(
		await executor.runEnterCommand('enter', {
			rollbackExitCommand: 'exit',
		}),
		true,
	);
	remoteCopyModeActiveRef.current = true;

	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(cleanup, null);
	assert.equal(await cleanup, false);
	assert.equal(cleanupBarrier.current(), null);
	assert.equal(remoteCopyModeActiveRef.current, true);

	const plan = buildTmuxScrollbackLiveInputSendPlan({
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
				remoteCopyModeExitCommand: 'exit',
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
	assert.deepEqual(commands, ['enter', 'exit', 'exit']);
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
			if (command === 'enter') await enterBlock.promise;
			if (command === 'exit') await exitBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
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
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.deepEqual(sentPayloads, []);
	exitBlock.resolve(undefined);

	assert.equal(await enter, false);
	await sendAfterCleanup;
	assert.deepEqual(sentPayloads, ['payload']);
	assert.deepEqual(commands, ['enter', 'exit']);
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
			if (command === 'enter') await enterBlock.promise;
			if (command === 'exit') {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
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
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.deepEqual(failures, ['exit failed']);
	assert.deepEqual(sentPayloads, []);
});

void test('pending enter rollback exit failure marks remote copy mode active for UI reset', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const cleanupBarrier = createTmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await enterBlock.promise;
			if (command === 'exit') {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
	await Promise.resolve();
	const cleanup = resetTmuxScrollbackRuntimeStateForUiReset({
		lineAccumulator,
		commandExecutor: executor,
		cleanupBarrier,
		remoteCopyModeActiveRef,
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(cleanup, null);
	enterBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.equal(remoteCopyModeActiveRef.current, true);
});

void test('multiple live input events wait behind the same pending scrollback cleanup barrier', async () => {
	const cleanupBlock = deferred<void>();
	const barrierRef = createTmuxScrollbackLiveInputCleanupBarrier();
	const sentPayloads: string[] = [];
	let scrollbackActive = true;

	const queueLiveInput = (
		payload: string,
		cleanup: Promise<boolean> | null = null,
	) => {
		const plan = buildTmuxScrollbackLiveInputSendPlan({
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
		const plan = buildTmuxScrollbackLiveInputSendPlan({
			scrollbackActive: true,
			payloadSegments: [bytes([payload.charCodeAt(0)])],
			scrollbackExitDelayMs: 10,
		});
		const cleanup = resolveTmuxScrollbackLiveInputCleanup({
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
	const barrierRef = createTmuxScrollbackLiveInputCleanupBarrier();
	const sentPayloads: string[] = [];
	let scrollbackActive = true;

	const externalCleanup = cleanupBlock.promise.then(() => true);
	scrollbackActive = false;
	void registerTmuxScrollbackLiveInputCleanup(barrierRef, externalCleanup);

	const plan = buildTmuxScrollbackLiveInputSendPlan({
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

void test('inactive AppState transition clears scrollback and waits for pending enter rollback', async () => {
	const enterBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await enterBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
	await Promise.resolve();
	const cleanup = handleTmuxScrollbackInactiveAppStateTransition({
		previousState: 'active',
		nextState: 'inactive',
		clearScrollbackState: () =>
			resetTmuxScrollbackRuntimeState({
				lineAccumulator,
				commandExecutor: executor,
			}),
		onCleanupError: () => {},
	});

	assert.notEqual(cleanup, null);
	enterBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, true);
	assert.deepEqual(commands, ['enter', 'exit']);
});

void test('inactive AppState transition ignores non-active previous states', () => {
	let cleanupCount = 0;

	const cleanup = handleTmuxScrollbackInactiveAppStateTransition({
		previousState: 'background',
		nextState: 'inactive',
		clearScrollbackState: () => {
			cleanupCount += 1;
			return null;
		},
		onCleanupError: () => {},
	});

	assert.equal(cleanup, null);
	assert.equal(cleanupCount, 0);
});

void test('inactive AppState transition ignores active next state', () => {
	let cleanupCount = 0;

	const cleanup = handleTmuxScrollbackInactiveAppStateTransition({
		previousState: 'active',
		nextState: 'active',
		clearScrollbackState: () => {
			cleanupCount += 1;
			return null;
		},
		onCleanupError: () => {},
	});

	assert.equal(cleanup, null);
	assert.equal(cleanupCount, 0);
});

void test('inactive AppState transition reports rejected cleanup', async () => {
	const cleanupError = new Error('cleanup failed');
	const reportedErrors: unknown[] = [];

	const cleanup = handleTmuxScrollbackInactiveAppStateTransition({
		previousState: 'active',
		nextState: 'inactive',
		clearScrollbackState: () => Promise.reject(cleanupError),
		onCleanupError: (error) => reportedErrors.push(error),
	});

	assert.notEqual(cleanup, null);
	if (!cleanup) {
		throw new Error('expected cleanup promise');
	}
	await assert.rejects(cleanup, cleanupError);
	await Promise.resolve();
	assert.deepEqual(reportedErrors, [cleanupError]);
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

void test('workmux scrollback failure actions alert and clear without cancel before remote ack', () => {
	const events: string[] = [];

	handleWorkmuxScrollbackCommandFailureActions({
		message: 'Update mdev',
		alert: (title, message, buttons) => {
			events.push(`alert:${title}:${message}:${buttons?.length ?? 0}`);
			buttons?.[0]?.onPress?.();
		},
		copyMessage: (message) => events.push(`copy:${message}`),
		clearScrollbackState: () => events.push('clear'),
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, [
		'warn:Update mdev',
		'alert:Workmux scroll unavailable:Update mdev:2',
		'copy:Update mdev',
		'clear',
	]);
});

void test('workmux scrollback failure actions clear even when notification throws', () => {
	const alertEvents: string[] = [];
	assert.throws(
		() =>
			handleWorkmuxScrollbackCommandFailureActions({
				message: 'Update mdev',
				alert: () => {
					alertEvents.push('alert');
					throw new Error('alert failed');
				},
				copyMessage: () => {},
				clearScrollbackState: () => alertEvents.push('clear'),
				warn: () => alertEvents.push('warn'),
			}),
		/alert failed/,
	);
	assert.deepEqual(alertEvents, ['warn', 'alert', 'clear']);

	const warnEvents: string[] = [];
	assert.throws(
		() =>
			handleWorkmuxScrollbackCommandFailureActions({
				message: 'Update mdev',
				alert: () => warnEvents.push('alert'),
				copyMessage: () => {},
				clearScrollbackState: () => warnEvents.push('clear'),
				warn: () => {
					warnEvents.push('warn');
					throw new Error('warn failed');
				},
			}),
		/warn failed/,
	);
	assert.deepEqual(warnEvents, ['warn', 'alert', 'clear']);
});

void test('workmux scrollback failure actions use supplied app-exit cleanup after remote copy mode is acknowledged', () => {
	const events: string[] = [];

	handleWorkmuxScrollbackCommandFailureActions({
		message: 'page failed',
		alert: (title, message) => events.push(`alert:${title}:${message}`),
		copyMessage: (message) => events.push(`copy:${message}`),
		clearScrollbackState: () => events.push('exit', 'clear'),
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, [
		'warn:page failed',
		'alert:Workmux scroll unavailable:page failed',
		'exit',
		'clear',
	]);
});

void test('dispose Workmux scroll exit failure logs without user alert', () => {
	const events: string[] = [];

	handleWorkmuxScrollbackDisposeExitFailureActions({
		message: 'Update mdev',
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, ['warn:Update mdev']);
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

	assert.deepEqual(commands, [
		"mdev tmux app scroll enter --session 'main'",
	]);
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

	assert.deepEqual(commands, [
		"mdev tmux app scroll enter --session 'main'",
	]);
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
		"command:mdev tmux app scroll enter --session 'main'",
		"command:mdev tmux app scroll exit --session 'main'",
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
		overrides: Partial<Parameters<typeof handleTmuxScrollbackEnterRequested>[0]>,
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

void test('scrollback batch adapter gates events and passes pageStep into command building', async () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const commands: string[][] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({ success: true, output: '' }),
		onFailure: () => {},
	});
	const enqueueScrollBatch = executor.enqueueScrollBatch.bind(executor);
	const baseEvent = {
		direction: 'up' as const,
		pages: 1,
		lines: 0,
		pageStep: 24,
		instanceId: 'current',
	};
	const runBatch = (
		overrides: Partial<Parameters<typeof handleTmuxScrollbackBatchEvent>[0]>,
	) =>
		handleTmuxScrollbackBatchEvent({
			event: baseEvent,
			shellAvailable: true,
			currentInstanceId: 'current',
			selectionModeEnabled: false,
			tmuxEnabled: true,
			connectionAvailable: true,
			scrollbackActive: true,
			targetName: 'main',
			lineAccumulator,
			enqueueScrollBatch: (batch) => {
				commands.push(batch);
				return enqueueScrollBatch(batch);
			},
			...overrides,
		});

	const rejectedCases: Partial<
		Parameters<typeof handleTmuxScrollbackBatchEvent>[0]
	>[] = [
		{ shellAvailable: false },
		{ currentInstanceId: 'other' },
		{ selectionModeEnabled: true },
		{ tmuxEnabled: false },
		{ connectionAvailable: false },
		{ scrollbackActive: false },
	];
	for (const rejected of rejectedCases) {
		assert.equal(runBatch(rejected), false);
	}
	assert.deepEqual(commands, []);

	for (const event of [
		{ ...baseEvent, direction: 'sideways' },
		{ ...baseEvent, pages: -1 },
		{ ...baseEvent, pages: Number.NaN },
		{ ...baseEvent, lines: -1 },
		{ ...baseEvent, lines: Number.POSITIVE_INFINITY },
		{ ...baseEvent, pageStep: 0 },
		{ ...baseEvent, pageStep: Number.NaN },
	]) {
		lineAccumulator.direction = 'up';
		lineAccumulator.lines = 12;
		assert.equal(
			runBatch({
				event: event as Parameters<typeof handleTmuxScrollbackBatchEvent>[0]['event'],
			}),
			false,
		);
		assert.deepEqual(lineAccumulator, { direction: 'up', lines: 12 });
	}
	assert.deepEqual(commands, []);
	lineAccumulator.direction = null;
	lineAccumulator.lines = 0;

	assert.equal(
		runBatch({
			event: {
				direction: 'up',
				pages: 0,
				lines: 23,
				pageStep: 24,
				instanceId: 'current',
			},
		}),
		false,
	);
	assert.equal(
		runBatch({
			event: {
				direction: 'up',
				pages: 0,
				lines: 1,
				pageStep: 24,
				instanceId: 'current',
			},
		}),
		true,
	);
	assert.equal(runBatch({}), true);

	assert.deepEqual(commands, [
		["mdev tmux app scroll page-up --count '1' --session 'main'"],
		["mdev tmux app scroll page-up --count '1' --session 'main'"],
	]);
});

void test('live input plan passes payload through when scrollback is inactive', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		segments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 7,
		clearScrollback: false,
	});
});

void test('live input plan drops empty payload segments while inactive', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: false,
		payloadSegments: [bytes([]), bytes([0x68]), bytes([]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(plan, {
		segments: [bytes([0x68]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		clearScrollback: false,
	});
});

void test('live input plan exits active scrollback without primary-shell cancel before payload', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x61, 0x62])],
		interSegmentDelayMs: 0,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x61, 0x62]]);
});

void test('live input plan drops the scrollback exit-key payload after cleanup', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x71])],
		scrollbackExitKeyPayload: bytes([0x71]),
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(segmentValues(plan.segments), []);
	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
});

void test('live input runner starts cleanup for exit-key-only payload without sending bytes', async () => {
	const cleanup = Promise.resolve(true);
	let cleanupStarted = 0;
	const sentSegments: number[][][] = [];
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x71])],
		scrollbackExitKeyPayload: bytes([0x71]),
		scrollbackExitDelayMs: 10,
	});

	const result = runTmuxScrollbackLiveInputSendPlan({
		plan,
		currentCleanup: null,
		startCleanup: () => {
			cleanupStarted += 1;
			return cleanup;
		},
		remoteCopyModeActive: true,
		sendSegments: (segments) => {
			sentSegments.push(segmentValues(segments));
		},
	});

	assert.equal(result, cleanup);
	assert.equal(cleanupStarted, 1);
	await cleanup;
	await Promise.resolve();
	assert.deepEqual(sentSegments, []);
});

void test('live input plan preserves multi-segment payload order after app-owned scrollback exit', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x68, 0x69]), bytes([0x0d])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.interSegmentDelayMs, 10);
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), [[0x68, 0x69], [0x0d]]);
});

void test('live input plan drops empty payload segments while preserving order', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([]), bytes([0x68]), bytes([]), bytes([0x69, 0x21])],
		interSegmentDelayMs: 3,
		scrollbackExitDelayMs: 10,
	});

	assert.deepEqual(segmentValues(plan.segments), [[0x68], [0x69, 0x21]]);
});
