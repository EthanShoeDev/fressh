import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getEmptyKeyPickerMessage,
	getInitialSelectedKeyId,
} from '../../src/lib/key-picker-state';

const keys = [
	{
		id: 'key_1',
		metadata: {
			priority: 0,
			createdAtMs: 1,
			label: 'Primary key',
			isDefault: true,
		},
		value: 'PRIVATE KEY',
	},
];

void test('getInitialSelectedKeyId prefers the existing field value', () => {
	assert.equal(getInitialSelectedKeyId(keys, 'key_1'), 'key_1');
});

void test('getInitialSelectedKeyId falls back to the default key', () => {
	assert.equal(getInitialSelectedKeyId(keys, ''), 'key_1');
});

void test('getInitialSelectedKeyId returns empty when no keys exist', () => {
	assert.equal(getInitialSelectedKeyId([], ''), '');
});

void test('getEmptyKeyPickerMessage points management to security center', () => {
	assert.equal(
		getEmptyKeyPickerMessage(),
		'Open Security Center to add or manage a key',
	);
});
