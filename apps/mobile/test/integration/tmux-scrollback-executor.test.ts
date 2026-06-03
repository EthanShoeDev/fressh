
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createWorkmuxScrollbackLiveInputCleanupBarrier,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLineAccumulator,
	registerTmuxScrollbackRemoteCopyModeExitCleanup,
	resetTmuxScrollbackRuntimeState,
	type WorkmuxScrollbackPageCommand,
} from '../../src/lib/tmux-scrollback';

const page = (
	count = 1,
	direction: WorkmuxScrollbackPageCommand['direction'] = 'up',
): WorkmuxScrollbackPageCommand => ({
	sessionName: 'main',
	direction,
	count,
});
const pageText = (
	count = 1,
	direction: WorkmuxScrollbackPageCommand['direction'] = 'up',
) => `mdev tmux app scroll page-${direction} --count '${count}' --session 'main'`;

const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

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
	const batch = executor.enqueueScrollBatch([page()]);

	await Promise.resolve();
	assert.deepEqual(commands, ['enter']);
	firstBlock.resolve(undefined);
	assert.equal(await enter, true);
	await batch;
	assert.deepEqual(commands, ['enter', pageText()]);
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
	assert.deepEqual(commands, [[pageText(1), pageText(1, 'down')].join(' && ')]);
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
	assert.deepEqual(events, [
		'failure:permission denied',
		'cancel',
		'clear',
	]);
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

	assert.equal(await executor.runEnterCommand('enter'), false);
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

	assert.equal(await executor.dispose({ exitCommand: 'exit' }), false);
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
	assert.deepEqual(await Promise.all(queued), queued.map(() => true));

	assert.deepEqual(commands, [
		pageText(),
		[
			pageText(20),
			pageText(20),
			pageText(20),
			pageText(20),
			pageText(20),
		].join(' && '),
	]);
});

void test('workmux scrollback executor runs a drained page batch in one shell command', async () => {
	const commands: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			return { success: true, output: '' };
		},
		onFailure: () => {},
	});

	assert.equal(await executor.enqueueScrollBatch([page(40), page(10)]), true);

	assert.deepEqual(commands, [[pageText(20), pageText(20), pageText(10)].join(' && ')]);
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
	const batch = executor.enqueueScrollBatch([page()]);
	void executor.dispose();

	assert.equal(await batch, false);
	firstBlock.resolve(undefined);
	assert.equal(await enter, false);
	assert.deepEqual(commands, ['enter']);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, ['enter']);
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

	assert.equal(await oldExecutor.dispose({ exitCommand: 'exit-main' }), true);
	assert.equal(await oldExecutor.runEnterCommand('enter-main'), false);
	assert.equal(await nextExecutor.runEnterCommand('enter-work'), true);

	assert.deepEqual(commands, ['exit-main', 'enter-work']);
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
	assert.deepEqual(commands, [pageText()]);
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
	const batch = executor.enqueueScrollBatch([page()]);

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
					remoteCopyModeExitCommand: 'exit',
				}),
			);
		},
	});

	const batch = executor.enqueueScrollBatch([page()]);

	assert.equal(await batch, false);
	assert.equal(resetPromises.length, 1);
	assert.notEqual(resetPromises[0], null);
	assert.equal(await resetPromises[0], true);
	assert.deepEqual(commands, [pageText(), 'exit']);
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
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.equal(await exit, true);
	assert.deepEqual(commands, [pageText(), 'exit']);
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
			if (command === 'exit') {
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
		remoteCopyModeExitCommand: 'exit',
	});

	assert.notEqual(exit, null);
	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.equal(await exit, false);
	assert.deepEqual(commands, [pageText(), 'exit']);
	assert.deepEqual(failures, ['exit failed']);
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
		remoteCopyModeExitCommand: 'exit',
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
	assert.deepEqual(commands, [pageText(), 'exit']);
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
	const exit = executor.dispose({ exitCommand: 'exit' });

	commandBlock.resolve(undefined);
	assert.equal(await scroll, false);
	assert.notEqual(exit, null);
	assert.equal(await exit, true);
	assert.deepEqual(commands, [pageText(), 'exit']);
	assert.equal(await executor.runEnterCommand('after-dispose'), false);
	assert.deepEqual(commands, [pageText(), 'exit']);
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

void test('dispose rollback exit failure can mark remote copy mode active for caller cleanup state', async () => {
	const commandBlock = deferred<void>();
	const commands: string[] = [];
	const cleanupBarrier = createWorkmuxScrollbackLiveInputCleanupBarrier();
	const remoteCopyModeActiveRef = { current: false };
	const executor = createWorkmuxScrollbackCommandExecutor({
		executeCommand: async (command) => {
			commands.push(command);
			if (command === 'enter') await commandBlock.promise;
			if (command === 'exit') {
				return { success: false, output: '', error: 'rollback exit failed' };
			}
			return { success: true, output: '' };
		},
		onFailure: () => {},
		onDisposeExitFailure: () => {},
	});

	const enter = executor.runEnterCommand('enter', {
		rollbackExitCommand: 'exit',
	});
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
	assert.deepEqual(commands, ['enter', 'exit']);
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
