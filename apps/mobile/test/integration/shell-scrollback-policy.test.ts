import assert from 'node:assert/strict';
import test from 'node:test';
import {
	handleShellWorkmuxScrollbackCommandFailureActions,
	handleShellWorkmuxScrollbackDisposeExitFailureActions,
	runShellScrollbackInactiveCleanup,
	shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive,
} from '../../src/app/shell/shell-scrollback-policy';

void test('shell scrollback inactive cleanup runs on active to non-active transitions', async () => {
	const events: string[] = [];
	const cleanup = runShellScrollbackInactiveCleanup({
		previousState: 'active',
		nextState: 'background',
		clearScrollbackState: () => {
			events.push('cleanup');
			return Promise.resolve(true);
		},
		warn: (message, error) => events.push(`warn:${message}:${String(error)}`),
	});

	assert.notEqual(cleanup, null);
	assert.equal(await cleanup, true);
	assert.deepEqual(events, ['cleanup']);
});

void test('shell scrollback inactive cleanup ignores non-active previous states and active next state', () => {
	let cleanupCount = 0;
	const clearScrollbackState = () => {
		cleanupCount += 1;
		return null;
	};
	const warn = () => {};

	assert.equal(
		runShellScrollbackInactiveCleanup({
			previousState: 'background',
			nextState: 'inactive',
			clearScrollbackState,
			warn,
		}),
		null,
	);
	assert.equal(
		runShellScrollbackInactiveCleanup({
			previousState: 'active',
			nextState: 'active',
			clearScrollbackState,
			warn,
		}),
		null,
	);
	assert.equal(cleanupCount, 0);
});

void test('shell scrollback inactive cleanup reports rejected and synchronous failures', async () => {
	const rejectedError = new Error('rejected cleanup');
	const syncError = new Error('sync cleanup');
	const events: string[] = [];
	const rejectedCleanup = runShellScrollbackInactiveCleanup({
		previousState: 'active',
		nextState: 'inactive',
		clearScrollbackState: () => Promise.reject(rejectedError),
		warn: (message, error) => events.push(`${message}:${String(error)}`),
	});

	assert.notEqual(rejectedCleanup, null);
	if (!rejectedCleanup) throw new Error('expected rejected cleanup promise');
	await assert.rejects(rejectedCleanup, rejectedError);
	await Promise.resolve();

	const syncCleanup = runShellScrollbackInactiveCleanup({
		previousState: 'active',
		nextState: 'background',
		clearScrollbackState: () => {
			throw syncError;
		},
		warn: (message, error) => events.push(`${message}:${String(error)}`),
	});

	assert.equal(syncCleanup, null);
	assert.deepEqual(events, [
		`Workmux inactive scrollback cleanup failed:${String(rejectedError)}`,
		`Workmux inactive scrollback cleanup failed:${String(syncError)}`,
	]);
});

void test('shell scrollback failure actions alert and clear without cancel before remote ack', () => {
	const events: string[] = [];

	handleShellWorkmuxScrollbackCommandFailureActions({
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

void test('shell scrollback failure actions clear even when notification throws', () => {
	const alertEvents: string[] = [];
	assert.throws(
		() =>
			handleShellWorkmuxScrollbackCommandFailureActions({
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
			handleShellWorkmuxScrollbackCommandFailureActions({
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

void test('shell scrollback failure actions use supplied app-exit cleanup after remote copy mode is acknowledged', () => {
	const events: string[] = [];

	handleShellWorkmuxScrollbackCommandFailureActions({
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

void test('shell scrollback failure policy treats scroll not-in-mode as remote already inactive', () => {
	assert.equal(
		shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive({
			commandKind: 'scroll',
			message: 'not in a mode',
		}),
		true,
	);
	assert.equal(
		shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive({
			commandKind: 'scroll',
			message: 'not in the mode',
		}),
		true,
	);
	assert.equal(
		shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive({
			commandKind: 'enter',
			message: 'not in a mode',
		}),
		false,
	);
	assert.equal(
		shouldTreatShellWorkmuxScrollbackFailureAsAlreadyInactive({
			commandKind: 'scroll',
			message: 'permission denied',
		}),
		false,
	);
});

void test('shell scrollback dispose exit failure logs without user alert', () => {
	const events: string[] = [];

	handleShellWorkmuxScrollbackDisposeExitFailureActions({
		message: 'Update mdev',
		warn: (message) => events.push(`warn:${message}`),
	});

	assert.deepEqual(events, ['warn:Update mdev']);
});
