import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackLiveInputSendPlan,
	buildWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createTmuxScrollbackLiveInputCleanupBarrier,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLineAccumulator,
	formatWorkmuxScrollbackCommandFailureMessage,
	handleWorkmuxScrollbackCommandFailureActions,
	handleTmuxScrollbackInactiveAppStateTransition,
	registerTmuxScrollbackLiveInputCleanup,
	resetTmuxScrollbackRuntimeStateForUiReset,
	resetTmuxScrollbackRuntimeState,
	shouldRunTmuxScrollbackRemoteResetForModeChange,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
} from '../../src/lib/tmux-scrollback';
import { WORKMUX_APP_SCROLL_MAX_COUNT } from '../../src/lib/workmux-app-commands';

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

void test('buildWorkmuxScrollbackBatchCommands builds page scroll commands', () => {
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 2,
			lines: 0,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		["mdev tmux app scroll page-up --count '2' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands accumulates sub-page lines by direction', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-down --count '1' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands accumulates rows-minus-one line batches into one receiver page', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const pageStep = 24;

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-up --count '1' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands resets line leftovers on direction change', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-up --count '1' --session 'main'"],
	);
});

void test('clearTmuxScrollbackLineAccumulator drops line leftovers', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	clearTmuxScrollbackLineAccumulator(lineAccumulator);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
});

void test('buildWorkmuxScrollbackBatchCommands splits page commands above Workmux max count', () => {
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 25,
			lines: 0,
			linesPerPage: 24,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		[
			"mdev tmux app scroll page-up --count '20' --session 'main'",
			"mdev tmux app scroll page-up --count '5' --session 'main'",
		],
	);
});

void test('buildWorkmuxScrollbackBatchCommands clamps malformed huge batches before splitting', () => {
	const commands = buildWorkmuxScrollbackBatchCommands({
		sessionName: 'main',
		direction: 'down',
		pages: 1_000_000,
		lines: 0,
		linesPerPage: 24,
		lineAccumulator: createTmuxScrollbackLineAccumulator(),
	});

	assert.equal(
		commands.length,
		Math.ceil(
			TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH /
				WORKMUX_APP_SCROLL_MAX_COUNT,
		),
	);
	assert.deepEqual(commands, [
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
		"mdev tmux app scroll page-down --count '20' --session 'main'",
	]);
});

void test('formatWorkmuxScrollbackCommandFailureMessage formats missing mdev failures', () => {
	assert.equal(
		formatWorkmuxScrollbackCommandFailureMessage({
			success: false,
			output: '',
			error: 'mdev: command not found',
		}),
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	);
	assert.equal(
		formatWorkmuxScrollbackCommandFailureMessage({
			success: true,
			output: '',
		}),
		null,
	);
});

void test('resetTmuxScrollbackRuntimeState clears stale line leftovers', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
	void resetTmuxScrollbackRuntimeState({ lineAccumulator });
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: 24,
			lineAccumulator,
		}),
		[],
	);
});

void test('workmux scrollback executor serializes enter before scroll batches', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') {
				await firstBlock.promise;
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter');
	const batch = executor.enqueueScrollBatch(['page']);

	await Promise.resolve();
	assert.deepEqual(commands, ['enter']);
	firstBlock.resolve(undefined);
	assert.equal(await enter, true);
	await batch;
	assert.deepEqual(commands, ['enter', 'page']);
});

void test('workmux scrollback executor suppresses enter ack and clears pending scroll after failure', async () => {
	const failures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: '',
			error: 'mdev: command not found',
		}),
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter');
	const batch = executor.enqueueScrollBatch(['page']);

	assert.equal(await enter, false);
	assert.equal(await batch, false);
	assert.deepEqual(failures, [
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	]);
});

void test('workmux scrollback executor formats thrown failures and stops a batch', async () => {
	const commands: string[] = [];
	const failures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'first') throw new Error('Command timed out');
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	assert.equal(await executor.enqueueScrollBatch(['first', 'second']), false);
	assert.deepEqual(commands, ['first']);
	assert.deepEqual(failures, ['Command timed out']);
});

void test('workmux scrollback executor invokes failure cleanup hooks', async () => {
	const events: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: 'permission denied',
			error: 'permission denied',
		}),
		onFailure: (message) => {
			events.push(`failure:${message}`);
			events.push('cancel');
			events.push('clear');
		},
	});

	assert.equal(await executor.runEnterCommand('enter'), false);
	assert.deepEqual(events, ['failure:permission denied', 'cancel', 'clear']);
});

void test('workmux scrollback executor coalesces pending scroll batches while slow command runs', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'first') await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const first = executor.enqueueScrollBatch(['first']);
	await Promise.resolve();
	assert.deepEqual(commands, ['first']);

	const stale = executor.enqueueScrollBatch(['stale']);
	const latest = executor.enqueueScrollBatch(['latest']);
	firstBlock.resolve(undefined);

	assert.equal(await first, true);
	assert.equal(await stale, false);
	assert.equal(await latest, true);
	assert.deepEqual(commands, ['first', 'latest']);
});

void test('workmux scrollback executor dispose clears pending scroll and blocks queued execution', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter');
	await Promise.resolve();
	const batch = executor.enqueueScrollBatch(['page']);
	void executor.dispose();

	assert.equal(await batch, false);
	firstBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter']);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, ['enter']);
});

void test('workmux scrollback executor dispose suppresses late failure callbacks', async () => {
	const commandBlock = deferred<void>();
	const failures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => {
			await commandBlock.promise;
			return { success: false, output: '', error: 'mdev: command not found' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter');
	await Promise.resolve();
	void executor.dispose();
	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.deepEqual(failures, []);
});

void test('resetTmuxScrollbackRuntimeState cancels in-flight enter and unwinds remote copy mode', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const failures: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
	await Promise.resolve();
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.deepEqual(failures, []);
});

void test('resetTmuxScrollbackRuntimeState cancels queued enter before it starts', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'blocking-scroll') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const blocking = executor.enqueueScrollBatch(['blocking-scroll']);
	await Promise.resolve();
	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await blocking, false);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['blocking-scroll']);
});

void test('resetTmuxScrollbackRuntimeState cancels pending Workmux scroll batches', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter');
	await Promise.resolve();
	const batch = executor.enqueueScrollBatch(['page']);

	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	assert.equal(await batch, false);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter']);
});

void test('workmux scrollback executor allows failure cleanup to re-enter with an exit command', async () => {
	const commands: string[] = [];
	const failures: string[] = [];
	const resetPromises: (Promise<boolean> | null)[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'page') {
				return {
					success: false,
					output: '',
					error: 'copyable page failure',
				};
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => {
			failures.push(message);
			resetPromises.push(
				resetTmuxScrollbackRuntimeState({
					lineAccumulator,
					commandExecutor: executor,
					remoteCopyModeExitCommand: 'exit',
				}),
			);
		},
	});

	const batch = executor.enqueueScrollBatch(['page']);

	assert.equal(await batch, false);
	assert.equal(resetPromises.length, 1);
	assert.notEqual(resetPromises[0], null);
	assert.equal(await resetPromises[0], true);
	assert.deepEqual(commands, ['page', 'exit']);
	assert.deepEqual(failures, ['copyable page failure']);
});

void test('resetTmuxScrollbackRuntimeState requests Workmux scroll exit for acknowledged remote copy mode', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'slow-page') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const page = executor.enqueueScrollBatch(['slow-page']);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await page, false);
	assert.equal(await exit, true);
	assert.deepEqual(commands, ['slow-page', 'exit']);
});

void test('resetTmuxScrollbackRuntimeState reports active Workmux scroll exit failures', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const failures: string[] = [];
	const disposeFailures: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'slow-page') await commandBlock.promise;
			if (command === 'exit') {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const page = executor.enqueueScrollBatch(['slow-page']);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await page, false);
	assert.equal(await exit, false);
	assert.deepEqual(commands, ['slow-page', 'exit']);
	assert.deepEqual(failures, ['exit failed']);
	assert.deepEqual(disposeFailures, []);
});

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

void test('resetTmuxScrollbackRuntimeState keeps queued Workmux scroll exit after repeated inactive reset', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'slow-page') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const page = executor.enqueueScrollBatch(['slow-page']);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		remoteCopyModeExitCommand: 'exit',
	});
	const repeatedReset = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});

	assert.equal(repeatedReset, null);
	commandBlock.resolve(undefined);
	assert.equal(await page, false);
	assert.notEqual(exit, null);
	assert.equal(await exit, true);
	assert.deepEqual(commands, ['slow-page', 'exit']);
});

void test('resetTmuxScrollbackRuntimeState skips Workmux scroll exit before remote copy mode ack', () => {
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});

	assert.equal(exit, null);
	assert.deepEqual(commands, []);
});

void test('workmux scrollback executor dispose requests Workmux scroll exit for acknowledged remote copy mode', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'slow-page') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const page = executor.enqueueScrollBatch(['slow-page']);
	await Promise.resolve();
	const exit = executor.dispose({ exitCommand: 'exit' });

	commandBlock.resolve(undefined);
	assert.equal(await page, false);
	assert.notEqual(exit, null);
	assert.equal(await exit, true);
	assert.deepEqual(commands, ['slow-page', 'exit']);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, ['slow-page', 'exit']);
});

void test('workmux scrollback executor dispose exit failures do not invoke active failure callback', async () => {
	const commands: string[] = [];
	const failures: string[] = [];
	const disposeFailures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: false, output: '', error: 'dispose exit failed' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const exit = executor.dispose({ exitCommand: 'exit' });

	assert.notEqual(exit, null);
	assert.equal(await exit, false);
	assert.deepEqual(commands, ['exit']);
	assert.deepEqual(failures, []);
	assert.deepEqual(disposeFailures, ['dispose exit failed']);
});

void test('workmux scrollback executor routes dispose rollback failures to dispose cleanup callback', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const failures: string[] = [];
	const disposeFailures: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			if (command === 'exit') {
				return { success: false, output: '', error: 'rollback exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
	await Promise.resolve();
	const cleanup = executor.dispose();

	assert.notEqual(cleanup, null);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, ['enter', 'exit']);
	assert.deepEqual(failures, []);
	assert.deepEqual(disposeFailures, ['rollback exit failed']);
});

void test('resetTmuxScrollbackRuntimeState returns a cleanup barrier for inactive in-flight app scroll enter before remote copy mode ack', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
	await Promise.resolve();
	const clearScrollbackState = () =>
		resetTmuxScrollbackRuntimeState({
			lineAccumulator,
			commandExecutor: executor,
		});
	const cleanup = clearScrollbackState();

	assert.notEqual(cleanup, null);
	let cleanupResolved = false;
	const cleanupSettled = cleanup?.then((value) => {
		cleanupResolved = true;
		return value;
	});
	await Promise.resolve();
	assert.equal(cleanupResolved, false);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanupSettled, true);
	assert.deepEqual(commands, ['enter', 'exit']);
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
		type: 'send',
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
		type: 'send',
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

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
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

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
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

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.deepEqual(segmentValues(plan.segments), [[0x68], [0x69, 0x21]]);
});

void test('live input plan can treat the payload as only a scrollback exit key', () => {
	const plan = buildTmuxScrollbackLiveInputSendPlan({
		scrollbackActive: true,
		payloadSegments: [bytes([0x71])],
		dropPayloadAfterExit: true,
		scrollbackExitDelayMs: 10,
	});

	assert.equal(plan.type, 'send');
	if (plan.type !== 'send') throw new Error('expected send plan');
	assert.equal(plan.clearScrollback, true);
	assert.deepEqual(segmentValues(plan.segments), []);
});
