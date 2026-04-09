import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getInitialSelectedKeyId,
	getKeyPickerViewState,
} from '../../src/lib/key-picker-state';

void test('preserves the current key while keys are still loading', () => {
	assert.equal(
		getInitialSelectedKeyId({
			keys: undefined,
			currentValue: 'key_existing',
			hasLoadedKeys: false,
		}),
		'key_existing',
	);
});

void test('keeps the current key after load when it still exists', () => {
	assert.equal(
		getInitialSelectedKeyId({
			keys: [
				{ id: 'key_existing', metadata: {} },
				{ id: 'key_secondary', metadata: {} },
			],
			currentValue: 'key_existing',
			hasLoadedKeys: true,
		}),
		'key_existing',
	);
});

void test('falls back to default key, then first key, then empty string after load', () => {
	assert.equal(
		getInitialSelectedKeyId({
			keys: [
				{ id: 'key_first', metadata: {} },
				{ id: 'key_default', metadata: { isDefault: true } },
			],
			currentValue: 'missing_key',
			hasLoadedKeys: true,
		}),
		'key_default',
	);

	assert.equal(
		getInitialSelectedKeyId({
			keys: [
				{ id: 'key_first', metadata: {} },
				{ id: 'key_second', metadata: {} },
			],
			currentValue: 'missing_key',
			hasLoadedKeys: true,
		}),
		'key_first',
	);

	assert.equal(
		getInitialSelectedKeyId({
			keys: [],
			currentValue: 'missing_key',
			hasLoadedKeys: true,
		}),
		'',
	);
});

void test('uses the computed fallback for visible state after keys load', () => {
	const result = getKeyPickerViewState({
		keys: [
			{ id: 'key_first', metadata: {} },
			{ id: 'key_default', metadata: { isDefault: true } },
		],
		currentValue: 'stale_key',
		hasLoadedKeys: true,
	});

	assert.deepEqual(result, {
		selectedId: 'key_default',
		display: 'key_default',
		showEmptyState: false,
	});
});

void test('keeps the current value visible while keys are still loading', () => {
	const result = getKeyPickerViewState({
		keys: undefined,
		currentValue: 'key_existing',
		hasLoadedKeys: false,
	});

	assert.deepEqual(result, {
		selectedId: 'key_existing',
		display: 'key_existing',
		showEmptyState: false,
	});
});
