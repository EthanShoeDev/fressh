import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveTextEntryWisprControl,
	resolveWisprTextEditorAvailability,
} from '../../src/lib/wispr-text-editor-flow';

void test('disabled Wispr service keeps text editor usable without opening settings', () => {
	const result = resolveWisprTextEditorAvailability({
		serviceEnabled: false,
		serviceConnected: false,
	});

	assert.deepEqual(result, {
		type: 'setup-required',
		reason: 'service-disabled',
		message: 'Wispr automation is disabled. Text entry is still available.',
		openAccessibilitySettings: false,
	});
});

void test('connected Wispr service starts automation', () => {
	const result = resolveWisprTextEditorAvailability({
		serviceEnabled: true,
		serviceConnected: true,
	});

	assert.deepEqual(result, { type: 'ready' });
});

void test('text entry shows disabled Wispr as compact setup pill', () => {
	const control = resolveTextEntryWisprControl({
		availability: {
			type: 'setup-required',
			reason: 'service-disabled',
			message: 'Wispr automation is disabled. Text entry is still available.',
			openAccessibilitySettings: false,
		},
		autoStartEnabled: false,
	});

	assert.deepEqual(control, {
		type: 'setup-pill',
		label: 'Wispr disabled',
	});
});

void test('text entry shows ready Wispr as session auto-start switch', () => {
	const control = resolveTextEntryWisprControl({
		availability: { type: 'ready' },
		autoStartEnabled: true,
	});

	assert.deepEqual(control, {
		type: 'switch',
		label: 'Wispr',
		enabled: true,
	});
});

void test('text entry shows compact disabled pill after Wispr automation failure', () => {
	const control = resolveTextEntryWisprControl({
		availability: { type: 'ready' },
		autoStartEnabled: true,
		automationState: {
			phase: 'failed',
			reason: 'bubble-not-found',
			message: 'Wispr bubble not found.',
		},
	});

	assert.deepEqual(control, {
		type: 'setup-pill',
		label: 'Wispr disabled',
	});
});
