import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createManualTerminalFitRunner,
	type ManualTerminalFitRunnerDeps,
	type ManualTerminalFitXterm,
} from '../../src/lib/terminal-fit-runner';

type Connection = { id: string };

function createHarness(
	overrides: Partial<ManualTerminalFitRunnerDeps<Connection>> = {},
) {
	const calls: string[] = [];
	const failures: { title: string; message: string }[] = [];
	const connection = { id: 'connection' };
	const xterm: ManualTerminalFitXterm = {
		fit: () => calls.push('fit'),
	};

	const deps: ManualTerminalFitRunnerDeps<Connection> = {
		getConnection: () => connection,
		isTmuxEnabled: () => true,
		getTerminalSize: () => ({ cols: 42, rows: 17 }),
		getXterm: () => xterm,
		getTargetName: () => 'main',
		waitForTerminalSizeAfterFit: undefined,
		resizePty: async (cols, rows) => {
			calls.push(`resizePty:${cols}x${rows}`);
		},
		executeSideChannelCommand: async (requestConnection, command, timeoutMs) => {
			assert.equal(requestConnection, connection);
			calls.push(`tmux:${command}:${String(timeoutMs)}`);
			return {
				success: true,
				output: '',
			};
		},
		showFailure: (title, message) => {
			failures.push({ title, message });
			calls.push(`failure:${title}:${message}`);
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		...overrides,
	};

	return {
		calls,
		connection,
		deps,
		failures,
		run: () => createManualTerminalFitRunner(deps).run(),
	};
}

void test('manual terminal fit resizes local PTY and tmux window', async () => {
	const harness = createHarness();

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'tmux:tmux resize-window -t main -x 42 -y 17 \\; set-window-option -t main window-size manual:30000',
	]);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit waits for size measured after fit', async () => {
	const harness = createHarness({
		getTerminalSize: () => ({ cols: 120, rows: 40 }),
		waitForTerminalSizeAfterFit: async () => ({ cols: 42, rows: 17 }),
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'tmux:tmux resize-window -t main -x 42 -y 17 \\; set-window-option -t main window-size manual:30000',
	]);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit resizes non-tmux PTY without tmux command', async () => {
	const harness = createHarness({
		isTmuxEnabled: () => false,
	});

	await harness.run();

	assert.deepEqual(harness.calls, ['fit', 'resizePty:42x17']);
	assert.deepEqual(harness.failures, []);
});

void test('manual terminal fit prompts fit when terminal size is missing', async () => {
	const harness = createHarness({
		getTerminalSize: () => null,
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'failure:Fit terminal failed:Terminal size is not ready yet. Try again.',
	]);
	assert.deepEqual(harness.failures, [
		{
			title: 'Fit terminal failed',
			message: 'Terminal size is not ready yet. Try again.',
		},
	]);
});

void test('manual terminal fit reports tmux resize failures', async () => {
	const harness = createHarness({
		executeSideChannelCommand: async () => ({
			success: false,
			output: '',
			error: 'resize failed',
		}),
	});

	await harness.run();

	assert.deepEqual(harness.calls, [
		'fit',
		'resizePty:42x17',
		'failure:Fit terminal failed:resize failed',
	]);
});
