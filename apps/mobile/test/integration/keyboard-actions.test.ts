import assert from 'node:assert/strict';
import test from 'node:test';
import { runAction } from '../../src/lib/keyboard-actions';

void test('keyboard navigation actions use runtime-configured targets instead of hardcoded ids', async () => {
	const selectedKeyboardIds: string[] = [];

	await runAction('OPEN_ADVANCED_KEYBOARD', {
		availableKeyboardIds: new Set(['custom_advanced']),
		selectKeyboard: (id) => {
			selectedKeyboardIds.push(id);
		},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		resolveKeyboardActionTarget: (actionId: string) =>
			actionId === 'OPEN_ADVANCED_KEYBOARD' ? 'custom_advanced' : null,
	} as Parameters<typeof runAction>[1]);

	assert.deepEqual(selectedKeyboardIds, ['custom_advanced']);
});
