import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS,
	buildMdevBridgeOperationFromWorkmuxArgv,
} from '../../src/lib/workmux-bridge-operations';

void test('required bridge operations exclude scroll operations', () => {
	assert.deepEqual(WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS, [
		'tmux.app.context',
		'tmux.app.window',
		'tmux.app.focus',
		'tmux.app.nav',
		'tmux.app.notification.open',
		'tmux.nav',
	]);
	assert.equal(
		WORKMUX_REQUIRED_MDEV_BRIDGE_OPERATIONS.some((operation) =>
			operation.includes('scroll'),
		),
		false,
	);
});

void test('maps Workmux app context argv', () => {
	assert.deepEqual(
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'context',
			'--session',
			'main',
		]),
		{ operation: 'tmux.app.context', params: { session: 'main' } },
	);
});

void test('maps Workmux app window argv', () => {
	assert.deepEqual(
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'window',
			'--session',
			'main',
		]),
		{ operation: 'tmux.app.window', params: { session: 'main' } },
	);
});

void test('maps Workmux notification open argv', () => {
	assert.deepEqual(
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'notification',
			'open',
			'--session',
			'main',
			'--window-id',
			'@12',
		]),
		{
			operation: 'tmux.app.notification.open',
			params: { session: 'main', windowId: '@12' },
		},
	);
});

void test('maps Workmux focus argv', () => {
	assert.deepEqual(
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'app',
			'focus',
			'codex',
			'--session',
			'main',
		]),
		{
			operation: 'tmux.app.focus',
			params: { roleOrDirection: 'codex', session: 'main' },
		},
	);
});

void test('maps Workmux nav action argv', () => {
	for (const action of ['next', 'prev', 'next-all', 'prev-all']) {
		assert.deepEqual(
			buildMdevBridgeOperationFromWorkmuxArgv([
				'tmux',
				'app',
				'nav',
				action,
				'--session',
				'main',
			]),
			{
				operation: 'tmux.app.nav',
				params: { action, session: 'main' },
			},
		);
	}
});

void test('maps Workmux nav select argv', () => {
	for (const index of ['0', '7', '10']) {
		assert.deepEqual(
			buildMdevBridgeOperationFromWorkmuxArgv([
				'tmux',
				'app',
				'nav',
				'select',
				index,
				'--session',
				'main',
			]),
			{
				operation: 'tmux.app.nav',
				params: { action: 'select', index: Number(index), session: 'main' },
			},
		);
	}
});

void test('maps status cycle argv', () => {
	assert.deepEqual(
		buildMdevBridgeOperationFromWorkmuxArgv([
			'tmux',
			'nav',
			'cycle',
			'main:',
		]),
		{
			operation: 'tmux.nav',
			params: { action: 'cycle', target: 'main:' },
		},
	);
});

void test('rejects malformed nav select index locally', () => {
	for (const index of ['1.5', '-1', 'NaN', '']) {
		assert.throws(
			() =>
				buildMdevBridgeOperationFromWorkmuxArgv([
					'tmux',
					'app',
					'nav',
					'select',
					index,
					'--session',
					'main',
				]),
			/Unsupported Workmux bridge command/,
		);
	}
});

void test('rejects unknown argv locally', () => {
	assert.throws(
		() =>
			buildMdevBridgeOperationFromWorkmuxArgv([
				'tmux',
				'app',
				'wat',
				'--session',
				'main',
			]),
		/Unsupported Workmux bridge command/,
	);
	assert.throws(
		() =>
			buildMdevBridgeOperationFromWorkmuxArgv([
				'tmux',
				'app',
				'scroll',
				'line-down',
				'--session',
				'main',
			]),
		/Unsupported Workmux bridge command/,
	);
});
