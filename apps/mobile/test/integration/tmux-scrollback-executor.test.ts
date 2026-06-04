import assert from 'node:assert/strict';
import test from 'node:test';
import {
	registerTmuxScrollbackRemoteCopyModeExitCleanup,
	resetTmuxScrollbackRuntimeState,
} from '../../src/lib/tmux-scrollback';
import {
	createTmuxScrollbackLineAccumulator,
	type WorkmuxScrollbackPageCommand,
} from '../../src/lib/workmux-scrollback-batch';
import {
	createWorkmuxScrollbackCommandExecutor as createBaseWorkmuxScrollbackCommandExecutor,
	executeWorkmuxScrollbackRemoteCommand,
	type WorkmuxScrollbackCommandResult,
} from '../../src/lib/workmux-scrollback-executor';
import { createWorkmuxScrollbackLiveInputCleanupBarrier } from '../../src/lib/workmux-scrollback-live-input';
import { type WorkmuxControlChannel } from '../../src/lib/workmux-control-channel';

const page = (
	count = 1,
	direction: WorkmuxScrollbackPageCommand['direction'] = 'up',
): WorkmuxScrollbackPageCommand => ({
	sessionName: 'main',
	direction,
	unit: 'page',
	count,
});
const line = (
	count = 1,
	direction: WorkmuxScrollbackPageCommand['direction'] = 'up',
): WorkmuxScrollbackPageCommand => ({
	sessionName: 'main',
	direction,
	unit: 'line',
	count,
});
const pageText = (
	count = 1,
	direction: WorkmuxScrollbackPageCommand['direction'] = 'up',
) => `move:main:${direction}:page:${count}`;
const lineText = (
	count = 1,
	direction: WorkmuxScrollbackPageCommand['direction'] = 'up',
) => `move:main:${direction}:line:${count}`;
const enterText = (sessionName = 'main') => `enter:${sessionName}`;
const exitText = (sessionName = 'main') => `exit:${sessionName}`;
const bytes = (text: string): ArrayBuffer =>
	new TextEncoder().encode(text).buffer as ArrayBuffer;

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

void test('workmux scrollback executor uses typed scroll transport for enter, move, and exit', async () => {
	const operations: string[] = [];
	const executor = createBaseWorkmuxScrollbackCommandExecutor({
		scrollTransport: {
			enter: async ({ sessionName }) => {
				operations.push(enterText(sessionName));
				return { success: true, output: '' };
			},
			move: async ({ sessionName, direction, unit, count }) => {
				operations.push(`move:${sessionName}:${direction}:${unit}:${count}`);
				return { success: true, output: '' };
			},
			exit: async ({ sessionName }) => {
				operations.push(exitText(sessionName));
				return { success: true, output: '' };
			},
		},
		onFailure: () => {},
	});

	assert.equal(await executor.runEnterCommand('main'), true);
	assert.equal(await executor.enqueueScrollBatch([page(2), line(3)]), true);
	assert.equal(
		await executor.reset({
			targetName: 'main',
		}),
		true,
	);
	assert.deepEqual(operations, [
		enterText(),
		pageText(2),
		lineText(3),
		exitText(),
	]);
});

void test('workmux scrollback executor serializes enter before scroll batches', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) {
				await firstBlock.promise;
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	const batch = executor.enqueueScrollBatch([page()]);

	await Promise.resolve();
	assert.deepEqual(commands, [enterText()]);
	firstBlock.resolve(undefined);
	assert.equal(await enter, true);
	await batch;
	assert.deepEqual(commands, [enterText(), pageText()]);
});

void test('workmux scrollback remote command uses noninteractive SSH exec output', async () => {
	const calls: string[] = [];
	const result = await executeWorkmuxScrollbackRemoteCommand({
		connection: {
			runCommand: async (opts) => {
				calls.push(opts.command);
				return {
					stdout: bytes(''),
					stderr: bytes('not in a mode\n'),
					exitStatus: 1,
					exitSignal: null,
				};
			},
		},
		command: "mdev tmux app scroll exit --session 'main'",
		timeoutMs: 500,
	});

	assert.deepEqual(calls, [
		`env PATH="$PATH:$HOME/bin" mdev tmux app scroll exit --session 'main'`,
	]);
	assert.deepEqual(result, {
		success: false,
		output: '',
		error: 'not in a mode',
		failureKind: 'exit-status',
		rawError: 'not in a mode',
		stderr: 'not in a mode\n',
		exitStatus: 1,
		exitSignal: null,
	});
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

	const enter = executor.runEnterCommand('main');
	const batch = executor.enqueueScrollBatch([page()]);

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
			if (command.includes(pageText(1))) throw new Error('Command timed out');
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	assert.equal(
		await executor.enqueueScrollBatch([page(1), page(1, 'down')]),
		false,
	);
	assert.deepEqual(commands, [pageText(1)]);
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

	assert.equal(await executor.runEnterCommand('main'), false);
	assert.deepEqual(events, ['failure:permission denied', 'cancel', 'clear']);
});

void test('workmux scrollback executor settles enter failure when callback throws', async () => {
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: '',
			error: 'enter failed',
		}),
		onFailure: () => {
			throw new Error('alert failed');
		},
	});

	assert.equal(await executor.runEnterCommand('main'), false);
});

void test('workmux scrollback executor settles scroll batch when failure callback throws', async () => {
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: '',
			error: 'scroll failed',
		}),
		onFailure: () => {
			throw new Error('alert failed');
		},
	});

	assert.equal(await executor.enqueueScrollBatch([page()]), false);
});

void test('workmux scrollback executor settles dispose exit when callback throws', async () => {
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => ({
			success: false,
			output: '',
			error: 'exit failed',
		}),
		onFailure: () => {},
		onDisposeExitFailure: () => {
			throw new Error('alert failed');
		},
	});

	assert.equal(await executor.dispose({ targetName: 'main' }), false);
});

void test('workmux scrollback executor preserves pending scroll batches while slow command runs', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === pageText()) await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const first = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	assert.deepEqual(commands, [pageText()]);

	const queued = executor.enqueueScrollBatch([page(2)]);
	const latest = executor.enqueueScrollBatch([page(3)]);
	firstBlock.resolve(undefined);

	assert.equal(await first, true);
	assert.equal(await queued, true);
	assert.equal(await latest, true);
	assert.deepEqual(commands, [pageText(), pageText(5)]);
});

void test('workmux scrollback executor bounds pending scroll fanout while slow command runs', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (commands.length === 1) await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const first = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	assert.deepEqual(commands, [pageText()]);

	const queued: Promise<boolean>[] = [];
	for (let index = 0; index < 1_000; index += 1) {
		queued.push(executor.enqueueScrollBatch([page(10)]));
	}

	firstBlock.resolve(undefined);
	assert.equal(await first, true);
	assert.deepEqual(
		await Promise.all(queued),
		queued.map(() => true),
	);

	assert.deepEqual(commands, [
		pageText(),
		pageText(20),
		pageText(20),
		pageText(20),
		pageText(20),
		pageText(20),
	]);
});

void test('workmux scrollback executor runs a drained page batch as typed moves', async () => {
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	assert.equal(await executor.enqueueScrollBatch([page(40), page(10)]), true);

	assert.deepEqual(commands, [pageText(20), pageText(20), pageText(10)]);
});

void test('workmux scrollback executor preserves page and line typed moves', async () => {
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	await executor.enqueueScrollBatch([page(1), line(7), line(2)]);

	assert.deepEqual(commands, [pageText(1), lineText(9)]);
});

void test('workmux scrollback executor dispose clears pending scroll and blocks queued execution', async () => {
	const firstBlock = deferred<void>();
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await firstBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const batch = executor.enqueueScrollBatch([page()]);
	void executor.dispose();

	assert.equal(await batch, false);
	firstBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, [enterText(), exitText()]);
});

void test('workmux scrollback executor replacement after target change is usable after disposing old executor', async () => {
	const commands: string[] = [];
	const createExecutor = () =>
		createWorkmuxScrollbackCommandExecutor({
			executeCommand: async (command) => {
				commands.push(command);
				return { success: true, output: '' };
			},
			onFailure: () => {},
		});

	const oldExecutor = createExecutor();
	const nextExecutor = createExecutor();

	assert.equal(await oldExecutor.dispose({ targetName: 'main' }), true);
	assert.equal(await oldExecutor.runEnterCommand('main'), false);
	assert.equal(await nextExecutor.runEnterCommand('work'), true);

	assert.deepEqual(commands, [exitText(), enterText('work')]);
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

	const enter = executor.runEnterCommand('main');
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
			if (command === enterText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.deepEqual(failures, []);
});

void test('resetTmuxScrollbackRuntimeState reports canceled enter command failures', async () => {
	const commandBlock = deferred<void>();
	const failures: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async () => {
			await commandBlock.promise;
			return { success: false, output: '', error: 'mdev: command not found' };
		},
		onFailure: (message) => failures.push(message),
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await enter, false);
	assert.deepEqual(failures, [
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	]);
});

void test('resetTmuxScrollbackRuntimeState cancels queued enter before it starts', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === pageText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const blocking = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	const enter = executor.runEnterCommand('main');
	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	commandBlock.resolve(undefined);

	assert.equal(await blocking, false);
	assert.equal(await enter, false);
	assert.deepEqual(commands, [pageText()]);
});

void test('resetTmuxScrollbackRuntimeState cancels pending Workmux scroll batches', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const batch = executor.enqueueScrollBatch([page()]);

	void resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});
	assert.equal(await batch, false);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, [enterText(), exitText()]);
});

void test('workmux scrollback executor allows failure cleanup to re-enter with an exit command', async () => {
	const commands: string[] = [];
	const failures: string[] = [];
	const resetPromises: (Promise<boolean> | null)[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === pageText()) {
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
					targetName: 'main',
				}),
			);
		},
	});

	const batch = executor.enqueueScrollBatch([page()]);

	assert.equal(await batch, false);
	assert.equal(resetPromises.length, 1);
	assert.notEqual(resetPromises[0], null);
	assert.equal(await resetPromises[0], true);
	assert.deepEqual(commands, [pageText(), exitText()]);
	assert.deepEqual(failures, ['copyable page failure']);
});

void test('resetTmuxScrollbackRuntimeState requests Workmux scroll exit for acknowledged remote copy mode', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === pageText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const scroll = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		targetName: 'main',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.equal(await exit, true);
	assert.deepEqual(commands, [pageText(), exitText()]);
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
			if (command === pageText()) await commandBlock.promise;
			if (command === exitText()) {
				return { success: false, output: '', error: 'exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const scroll = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		targetName: 'main',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.equal(await exit, false);
	assert.deepEqual(commands, [pageText(), exitText()]);
	assert.deepEqual(failures, ['exit failed']);
	assert.deepEqual(disposeFailures, []);
});

void test('resetTmuxScrollbackRuntimeState reports typed Workmux scroll exit failures', async () => {
	const failures: string[] = [];
	const disposeFailures: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			if (command === exitText()) {
				return { success: false, output: '', error: 'not in a mode' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		targetName: 'main',
	});

	assert.notEqual(exit, null);
	assert.equal(await exit, false);
	assert.deepEqual(failures, ['not in a mode']);
	assert.deepEqual(disposeFailures, []);
});

void test('resetTmuxScrollbackRuntimeState keeps queued Workmux scroll exit after repeated inactive reset', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === pageText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const scroll = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	const exit = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
		targetName: 'main',
	});
	const repeatedReset = resetTmuxScrollbackRuntimeState({
		lineAccumulator,
		commandExecutor: executor,
	});

	assert.equal(repeatedReset, null);
	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.notEqual(exit, null);
	assert.equal(await exit, true);
	assert.deepEqual(commands, [pageText(), exitText()]);
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
			if (command === pageText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const scroll = executor.enqueueScrollBatch([page()]);
	await Promise.resolve();
	const exit = executor.dispose({ targetName: 'main' });

	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.notEqual(exit, null);
	assert.equal(await exit, true);
	assert.deepEqual(commands, [pageText(), exitText()]);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, [pageText(), exitText()]);
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

	const exit = executor.dispose({ targetName: 'main' });

	assert.notEqual(exit, null);
	assert.equal(await exit, false);
	assert.deepEqual(commands, [exitText()]);
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
			if (command === enterText()) await commandBlock.promise;
			if (command === exitText()) {
				return { success: false, output: '', error: 'rollback exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: (message) => failures.push(message),
		onDisposeExitFailure: (message) => disposeFailures.push(message),
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const cleanup = executor.dispose();

	assert.notEqual(cleanup, null);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.deepEqual(failures, []);
	assert.deepEqual(disposeFailures, ['rollback exit failed']);
});

void test('dispose rollback exit failure can mark remote copy mode active for caller cleanup state', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await commandBlock.promise;
			if (command === exitText()) {
				return { success: false, output: '', error: 'rollback exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
		onDisposeExitFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
	await Promise.resolve();
	const cleanup = registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup: executor.dispose(),
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive: remoteCopyModeActiveRef.current,
		markRemoteCopyModeActiveOnFailedCleanup: true,
	});

	assert.notEqual(cleanup, null);
	commandBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.equal(await cleanup, false);
	assert.deepEqual(commands, [enterText(), exitText()]);
	assert.equal(remoteCopyModeActiveRef.current, true);
});

void test('stale remote copy mode cleanup cannot clear a newer scrollback generation', async () => {
	const cleanupBlock = deferred<boolean>();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: true };
	const cleanupGeneration = { current: 1 };
	const cleanup = registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup: cleanupBlock.promise,
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive: remoteCopyModeActiveRef.current,
		cleanupGeneration,
	});

	assert.notEqual(cleanup, null);
	cleanupGeneration.current += 1;
	remoteCopyModeActiveRef.current = true;
	cleanupBlock.resolve(true);
	assert.equal(await cleanup, true);
	assert.equal(remoteCopyModeActiveRef.current, true);
});

void test('successful current remote copy mode cleanup clears active state', async () => {
	const cleanupBlock = deferred<boolean>();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: true };
	const cleanupGeneration = { current: 1 };
	const cleanup = registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup: cleanupBlock.promise,
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive: remoteCopyModeActiveRef.current,
		cleanupGeneration,
	});

	assert.notEqual(cleanup, null);
	cleanupBlock.resolve(true);
	assert.equal(await cleanup, true);
	assert.equal(remoteCopyModeActiveRef.current, false);
});

void test('stale failed remote copy mode cleanup cannot mark a newer generation active', async () => {
	const cleanupBlock = deferred<boolean>();
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const cleanupGeneration = { current: 1 };
	const cleanup = registerTmuxScrollbackRemoteCopyModeExitCleanup({
		barrier: cleanupBarrier,
		cleanup: cleanupBlock.promise,
		remoteCopyModeActiveRef,
		remoteCopyModeWasActive: true,
		markRemoteCopyModeActiveOnFailedCleanup: true,
		cleanupGeneration,
	});

	assert.notEqual(cleanup, null);
	cleanupGeneration.current += 1;
	cleanupBlock.resolve(false);
	assert.equal(await cleanup, false);
	assert.equal(remoteCopyModeActiveRef.current, false);
});

void test('resetTmuxScrollbackRuntimeState returns a cleanup barrier for inactive in-flight app scroll enter before remote copy mode ack', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === enterText()) await commandBlock.promise;
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	const enter = executor.runEnterCommand('main');
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
	assert.deepEqual(commands, [enterText(), exitText()]);
});
