import assert from 'node:assert/strict';
import test from 'node:test';
import { detachTerminalShellListener } from '../../src/lib/terminal-shell-listener';

void test('terminal reload detach removes live shell listener and clears attach state', () => {
	const removed: bigint[] = [];
	const warnings: unknown[] = [];
	const listenerIdRef = { current: 123n as bigint | null };
	const listenerOwnerRef = {
		current: {
			removeListener: (id: bigint) => {
				removed.push(id);
			},
		} as { removeListener: (id: bigint) => void } | null,
	};
	const attachedShellKeyRef = { current: 'connection:channel' as string | null };

	detachTerminalShellListener({
		shell: null,
		listenerOwnerRef,
		listenerIdRef,
		attachedShellKeyRef,
		logger: {
			warn: (...args) => warnings.push(args),
		},
	});

	assert.deepEqual(removed, [123n]);
	assert.equal(listenerIdRef.current, null);
	assert.equal(listenerOwnerRef.current, null);
	assert.equal(attachedShellKeyRef.current, null);
	assert.deepEqual(warnings, []);
});

void test('terminal reload detach clears attach state when removal fails', () => {
	const listenerIdRef = { current: 123n as bigint | null };
	const error = new Error('remove failed');
	const listenerOwnerRef = {
		current: {
			removeListener: () => {
				throw error;
			},
		} as { removeListener: (id: bigint) => void } | null,
	};
	const attachedShellKeyRef = { current: 'connection:channel' as string | null };
	const warnings: unknown[] = [];

	detachTerminalShellListener({
		shell: null,
		listenerOwnerRef,
		listenerIdRef,
		attachedShellKeyRef,
		logger: {
			warn: (...args) => warnings.push(args),
		},
	});

	assert.equal(listenerIdRef.current, null);
	assert.equal(listenerOwnerRef.current, null);
	assert.equal(attachedShellKeyRef.current, null);
	assert.deepEqual(warnings, [
		['Failed to remove prior shell listener', error],
	]);
});

void test('terminal reload detach removes from listener owner instead of current shell', () => {
	const removedFromOwner: bigint[] = [];
	const removedFromCurrent: bigint[] = [];
	const listenerIdRef = { current: 123n as bigint | null };
	const listenerOwnerRef = {
		current: {
			removeListener: (id: bigint) => removedFromOwner.push(id),
		} as { removeListener: (id: bigint) => void } | null,
	};
	const attachedShellKeyRef = { current: 'old-shell' as string | null };

	detachTerminalShellListener({
		shell: {
			removeListener: (id: bigint) => removedFromCurrent.push(id),
		},
		listenerOwnerRef,
		listenerIdRef,
		attachedShellKeyRef,
		logger: {
			warn: () => {},
		},
	});

	assert.deepEqual(removedFromOwner, [123n]);
	assert.deepEqual(removedFromCurrent, []);
	assert.equal(listenerIdRef.current, null);
	assert.equal(listenerOwnerRef.current, null);
	assert.equal(attachedShellKeyRef.current, null);
});
