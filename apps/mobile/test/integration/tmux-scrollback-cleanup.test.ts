
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackLiveInputSendPlan,
	createTmuxScrollbackLiveInputCleanupBarrier,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLineAccumulator,
	handleTmuxScrollbackInactiveAppStateTransition,
	handleWorkmuxScrollbackCommandFailureActions,
	registerTmuxScrollbackLiveInputCleanup,
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
