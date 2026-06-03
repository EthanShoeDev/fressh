import assert from 'node:assert/strict';
import test from 'node:test';
import { detachTerminalShellListener } from '../../src/lib/terminal-shell-listener';

void test('terminal reload detach removes live shell listener and clears attach state', () => {
	const removed: bigint[] = [];
	const warnings: unknown[] = [];
	const listenerIdRef = { current: 123n as bigint | null };
	const attachedShellKeyRef = { current: 'connection:channel' as string | null };

	detachTerminalShellListener({
		shell: {
			removeListener: (id) => {
				removed.push(id);
			},
		},
		listenerIdRef,
		attachedShellKeyRef,
		logger: {
			warn: (...args) => warnings.push(args),
		},
	});

	assert.deepEqual(removed, [123n]);
	assert.equal(listenerIdRef.current, null);
	assert.equal(attachedShellKeyRef.current, null);
	assert.deepEqual(warnings, []);
});

void test('terminal reload detach clears attach state when removal fails', () => {
	const listenerIdRef = { current: 123n as bigint | null };
	const attachedShellKeyRef = { current: 'connection:channel' as string | null };
	const warnings: unknown[] = [];
	const error = new Error('remove failed');

	detachTerminalShellListener({
		shell: {
			removeListener: () => {
				throw error;
			},
		},
		listenerIdRef,
		attachedShellKeyRef,
		logger: {
			warn: (...args) => warnings.push(args),
		},
	});

	assert.equal(listenerIdRef.current, null);
	assert.equal(attachedShellKeyRef.current, null);
	assert.deepEqual(warnings, [
		['Failed to remove prior shell listener', error],
	]);
});
