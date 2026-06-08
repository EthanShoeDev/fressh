import assert from 'node:assert/strict';
import test from 'node:test';
import {
	executeRemoteCommand,
	runRemoteTextCommand,
} from '../../src/lib/remote-command-runner';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function createConnection(result: {
	stdout?: string;
	stderr?: string;
	exitStatus?: number | null;
	exitSignal?: string | null;
	onRun?: (signal: AbortSignal | undefined) => void;
}) {
	const calls: { command: string; signal: AbortSignal | undefined }[] = [];
	return {
		calls,
		connection: {
			runCommand: async (
				opts: { command: string },
				asyncOpts?: { signal?: AbortSignal },
			) => {
				calls.push({ command: opts.command, signal: asyncOpts?.signal });
				result.onRun?.(asyncOpts?.signal);
				return {
					stdout: bytes(result.stdout ?? ''),
					stderr: bytes(result.stderr ?? ''),
					exitStatus: result.exitStatus === undefined ? 0 : result.exitStatus,
					exitSignal: result.exitSignal ?? null,
				};
			},
		},
	};
}

void test('executeRemoteCommand returns decoded stdout on zero exit', async () => {
	const fixture = createConnection({
		stdout: 'hello\n',
		stderr: '',
		exitStatus: 0,
	});

	const result = await executeRemoteCommand({
		connection: fixture.connection,
		command: 'printf hello',
		timeoutMs: 500,
	});

	assert.deepEqual(fixture.calls, [
		{
			command: 'printf hello',
			signal: fixture.calls[0]?.signal,
		},
	]);
	assert.equal(fixture.calls[0]?.signal instanceof AbortSignal, true);
	assert.deepEqual(result, {
		success: true,
		output: 'hello\n',
		error: undefined,
		stderr: '',
		exitStatus: 0,
		exitSignal: null,
	});
});

void test('runRemoteTextCommand trims stdout and maps old mdev failures', async () => {
	const success = createConnection({
		stdout: '  hello\n',
		stderr: '',
		exitStatus: 0,
	});
	assert.equal(
		await runRemoteTextCommand({
			connection: success.connection,
			command: 'printf hello',
			timeoutMs: 500,
		}),
		'hello',
	);

	const fixture = createConnection({
		stdout: '',
		stderr: 'Unknown tmux command: app\n',
		exitStatus: 1,
	});

	await assert.rejects(
		runRemoteTextCommand({
			connection: fixture.connection,
			command: 'mdev tmux app window --session main',
			timeoutMs: 500,
		}),
		(error) =>
			error instanceof Error &&
			error.message === WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.deepEqual(fixture.calls, []);
});

void test('executeRemoteCommand blocks Workmux app command strings', async () => {
	const fixture = createConnection({
		stdout: 'should not run',
		stderr: '',
		exitStatus: 0,
	});

	assert.deepEqual(
		await executeRemoteCommand({
			connection: fixture.connection,
			command: 'mdev tmux app window --session main',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: '',
			error: WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
			failureKind: 'blocked-command',
			stderr: '',
			exitStatus: null,
			exitSignal: null,
		},
	);
	assert.deepEqual(fixture.calls, []);
});

void test('executeRemoteCommand reports exit signals and missing exit status', async () => {
	const signaled = createConnection({
		stdout: '',
		stderr: '',
		exitStatus: null,
		exitSignal: 'TERM',
	});
	assert.deepEqual(
		await executeRemoteCommand({
			connection: signaled.connection,
			command: 'listen',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: '',
			error: 'Remote command exited with signal TERM.',
			failureKind: 'exit-signal',
			stderr: '',
			exitStatus: null,
			exitSignal: 'TERM',
		},
	);

	const missing = createConnection({
		stdout: '',
		stderr: '',
		exitStatus: null,
	});
	const missingResult = await executeRemoteCommand({
		connection: missing.connection,
		command: 'listen',
		timeoutMs: 500,
	});
	assert.deepEqual(missingResult, {
		success: false,
		output: '',
		error: 'Remote command exited without status.',
		failureKind: 'missing-exit-status',
		stderr: '',
		exitStatus: null,
		exitSignal: null,
	});
});

void test('executeRemoteCommand reports concrete status without command output', async () => {
	const fixture = createConnection({
		stdout: '',
		stderr: '',
		exitStatus: 7,
	});

	assert.deepEqual(
		await executeRemoteCommand({
			connection: fixture.connection,
			command: 'false',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: '',
			error: 'Remote command exited with status 7.',
			failureKind: 'exit-status',
			stderr: '',
			exitStatus: 7,
			exitSignal: null,
		},
	);
});

void test('executeRemoteCommand preserves stdout-only generic failure text', async () => {
	const fixture = createConnection({
		stdout: 'Unknown tmux command: app\n',
		stderr: '',
		exitStatus: 2,
	});

	assert.deepEqual(
		await executeRemoteCommand({
			connection: fixture.connection,
			command: 'tmux app window',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: 'Unknown tmux command: app\n',
			error: 'Unknown tmux command: app',
			failureKind: 'exit-status',
			rawError: 'Unknown tmux command: app',
			stderr: '',
			exitStatus: 2,
			exitSignal: null,
		},
	);
});

void test('executeRemoteCommand reports native command rejections distinctly', async () => {
	const connection = {
		runCommand: async () => {
			throw new Error('native transport failed');
		},
	};

	assert.deepEqual(
		await executeRemoteCommand({
			connection,
			command: 'git status',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: '',
			error: 'native transport failed',
			failureKind: 'native-error',
			rawError: 'native transport failed',
			stderr: '',
			exitStatus: null,
			exitSignal: null,
		},
	);
});

void test('executeRemoteCommand does not classify native timeout text as wrapper timeout', async () => {
	const connection = {
		runCommand: async () => {
			throw new Error('Remote command timed out');
		},
	};

	assert.deepEqual(
		await executeRemoteCommand({
			connection,
			command: 'git status',
			timeoutMs: 500,
		}),
		{
			success: false,
			output: '',
			error: 'Remote command timed out',
			failureKind: 'native-error',
			rawError: 'Remote command timed out',
			stderr: '',
			exitStatus: null,
			exitSignal: null,
		},
	);
});

void test('executeRemoteCommand aborts timed-out native commands with stable timeout message', async () => {
	let abortedSignal: AbortSignal | undefined;
	const connection = {
		runCommand: async (
			_opts: { command: string },
			asyncOpts?: { signal?: AbortSignal },
		) =>
			new Promise<{
				stdout: ArrayBuffer;
				stderr: ArrayBuffer;
				exitStatus: number | null;
				exitSignal: string | null;
			}>((_resolve, reject) => {
				asyncOpts?.signal?.addEventListener('abort', () => {
					abortedSignal = asyncOpts.signal;
					reject(new Error('Native abort won the race'));
				});
			}),
	};

	const result = await executeRemoteCommand({
		connection,
		command: 'sleep forever',
		timeoutMs: 1,
	});

	assert.equal(abortedSignal?.aborted, true);
	assert.equal(abortedSignal?.reason instanceof Error, true);
	assert.equal(abortedSignal?.reason.message, 'Remote command timed out');
	assert.deepEqual(result, {
		success: false,
		output: '',
		error: 'Remote command timed out',
		failureKind: 'timeout',
		rawError: 'Remote command timed out',
		stderr: '',
		exitStatus: null,
		exitSignal: null,
	});
});
