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

void test('tmux history action toggles history mode through the action context', async () => {
	let toggled = 0;

	await runAction('OPEN_TMUX_HISTORY', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		toggleTmuxHistory: () => {
			toggled += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(toggled, 1);
});

void test('Wispr text action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_WISPR_TEXT_EDITOR', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openWisprTextEditor: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
});
