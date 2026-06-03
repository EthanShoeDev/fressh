import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupBrowserActionRequests } from '../../src/lib/browser-actions-request-cleanup';
import { type RequestIdHandle } from '../../src/lib/request-id';
import {
	createWorkmuxStatusCycleHandle,
	runWorkmuxStatusCycleRequest,
} from '../../src/lib/workmux-status-cycle';

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
	const handle = createWorkmuxStatusCycleHandle({ requestId, inFlightRef });
	const commandBlock = deferred<string>();
	const commands: string[] = [];
	const errors: string[] = [];

	const started = runWorkmuxStatusCycleRequest({
		tmuxEnabled: true,
		tmuxTarget: 'main',
		handle,
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
		handle,
		runHostBrowserCommand: async () => 'ignored',
		showError: (title, message) => errors.push(`${title}:${message}`),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.equal(started, true);
	assert.equal(overlapped, false);
	assert.deepEqual(commands, ["mdev tmux nav cycle 'main:':10000"]);

	handle.invalidate();
	assert.equal(inFlightRef.current, false);
	commandBlock.reject(new Error('stale failure'));
	await assert.rejects(commandBlock.promise, /stale failure/);
	await Promise.resolve();

	assert.deepEqual(errors, []);

	const restarted = runWorkmuxStatusCycleRequest({
		tmuxEnabled: true,
		tmuxTarget: 'main',
		handle,
		runHostBrowserCommand: async () => '',
		showError: () => {
			throw new Error('unexpected restart error');
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});
	assert.equal(restarted, true);
});

void test('browser action request cleanup invalidates status cycle with other browser requests', () => {
	const events: string[] = [];
	const requestId = (name: string): RequestIdHandle => ({
		next: () => 0,
		isCurrent: () => false,
		invalidate: () => events.push(`invalidate:${name}`),
	});
	const inFlightRefs = {
		hostUrlSubmit: { current: true },
		hostDiffity: { current: true },
		hostDetectedOpen: { current: true },
		statusCycle: { current: true },
	};
	const statusCycleHandle = createWorkmuxStatusCycleHandle({
		requestId: requestId('statusCycle'),
		inFlightRef: inFlightRefs.statusCycle,
	});

	cleanupBrowserActionRequests({
		hostUrlReadRequestId: requestId('hostUrlRead'),
		hostUrlSubmitRequestId: requestId('hostUrlSubmit'),
		hostUrlSubmitInFlightRef: inFlightRefs.hostUrlSubmit,
		browserGitHubTargetRequestId: requestId('browserGitHubTarget'),
		hostDiffityRequestId: requestId('hostDiffity'),
		hostDiffityInFlightRef: inFlightRefs.hostDiffity,
		hostDetectedOpenRequestId: requestId('hostDetectedOpen'),
		hostDetectedOpenInFlightRef: inFlightRefs.hostDetectedOpen,
		statusCycleHandle,
	});

	assert.deepEqual(events, [
		'invalidate:hostUrlRead',
		'invalidate:hostUrlSubmit',
		'invalidate:browserGitHubTarget',
		'invalidate:hostDiffity',
		'invalidate:hostDetectedOpen',
		'invalidate:statusCycle',
	]);
	assert.equal(inFlightRefs.hostUrlSubmit.current, false);
	assert.equal(inFlightRefs.hostDiffity.current, false);
	assert.equal(inFlightRefs.hostDetectedOpen.current, false);
	assert.equal(inFlightRefs.statusCycle.current, false);
});
