import assert from 'node:assert/strict';
import test from 'node:test';
import {
	describeConnectionsUsingKey,
	listConnectionsUsingKey,
} from '../../src/lib/key-usage';

const entries = [
	{
		id: 'muly-dev-box-22',
		metadata: {
			priority: 0,
			createdAtMs: 1,
			modifiedAtMs: 2,
			label: 'Dev Box',
		},
		value: {
			host: 'dev-box',
			port: 22,
			username: 'muly',
			security: { type: 'key' as const, keyId: 'key_1' },
			useTmux: true,
			tmuxSessionName: 'main',
			autoConnect: false,
		},
	},
	{
		id: 'muly-staging-box-22',
		metadata: {
			priority: 0,
			createdAtMs: 3,
			modifiedAtMs: 4,
		},
		value: {
			host: 'staging-box',
			port: 22,
			username: 'muly',
			security: { type: 'key' as const, keyId: 'key_2' },
			useTmux: true,
			tmuxSessionName: 'main',
			autoConnect: false,
		},
	},
];

void test('listConnectionsUsingKey returns only connections that reference the key', () => {
	const matches = listConnectionsUsingKey(entries, 'key_1');
	assert.equal(matches.length, 1);
	assert.equal(matches[0]?.id, 'muly-dev-box-22');
});

void test('describeConnectionsUsingKey prefers saved labels and falls back to ids', () => {
	assert.deepEqual(describeConnectionsUsingKey(entries, 'key_1'), ['Dev Box']);
	assert.deepEqual(describeConnectionsUsingKey(entries, 'key_2'), [
		'muly-staging-box-22',
	]);
});
