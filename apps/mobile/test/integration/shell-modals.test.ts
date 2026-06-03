import assert from 'node:assert/strict';
import test from 'node:test';
import { type RequestIdHandle } from '../../src/lib/request-id';
import { runWorkmuxStatusCycleRequest } from '../../src/lib/workmux-status-cycle';

const createRequestId = (): RequestIdHandle => {
	let current = 0;
	return {
		next: () => {
			current += 1;
			return current;
		},
		isCurrent: (id) => id === current,
		invalidate: () => {
			current += 1;
		},
	};
};

const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

void test('status cycle request serializes in-flight commands and suppresses stale errors', async () => {
	const requestId = createRequestId();
	const inFlightRef = { current: false };
	const commandBlock = deferred<string>();
	const commands: string[] = [];
	const errors: string[] = [];

	const started = runWorkmuxStatusCycleRequest({
		tmuxEnabled: true,
		tmuxTarget: 'main',
		requestId,
		inFlightRef,
		runHostBrowserCommand: async (command, timeoutMs) => {
			commands.push(`${command}:${timeoutMs?.toString() ?? ''}`);
			return commandBlock.promise;
		},
		showError: (title, message) => errors.push(`${title}:${message}`),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});
	const overlapped = runWorkmuxStatusCycleRequest({
		tmuxEnabled: true,
		tmuxTarget: 'main',
		requestId,
		inFlightRef,
		runHostBrowserCommand: async () => 'ignored',
		showError: (title, message) => errors.push(`${title}:${message}`),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.equal(started, true);
	assert.equal(overlapped, false);
	assert.deepEqual(commands, ["mdev tmux nav cycle 'main:':10000"]);

	requestId.invalidate();
	inFlightRef.current = false;
	commandBlock.reject(new Error('stale failure'));
	await assert.rejects(commandBlock.promise, /stale failure/);
	await Promise.resolve();

	assert.deepEqual(errors, []);
});
