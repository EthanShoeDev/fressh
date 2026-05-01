import assert from 'node:assert/strict';
import test from 'node:test';
import { KNOWN_ACTION_IDS, runAction } from '../../src/lib/keyboard-actions';

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

void test('tmux history is not a known keyboard action', () => {
	assert.equal(
		KNOWN_ACTION_IDS.includes(
			'OPEN_TMUX_HISTORY' as (typeof KNOWN_ACTION_IDS)[number],
		),
		false,
	);
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
