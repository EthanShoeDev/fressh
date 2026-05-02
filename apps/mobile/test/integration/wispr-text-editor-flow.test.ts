import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWisprTextEditorAvailability } from '../../src/lib/wispr-text-editor-flow';

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
