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

void test('skill selector action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_SKILL_SELECTOR', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openSkillSelector: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
});

void test('repo feature request action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_REPO_FEATURE_REQUEST', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openRepoFeatureRequest: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
});

void test('host browser actions delegate to action context callbacks', async () => {
	const openedSlots: string[] = [];
	const editedSlots: string[] = [];
	let diffityOpened = 0;
	let statusCycled = 0;

	const context = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openHostDiffity: () => {
			diffityOpened += 1;
		},
		openHostUrlSlot: (slot: string) => {
			openedSlots.push(slot);
		},
		editHostUrlSlot: (slot: string) => {
			editedSlots.push(slot);
		},
		cycleWorkmuxStatus: () => {
			statusCycled += 1;
		},
	} as Parameters<typeof runAction>[1];

	await runAction('OPEN_HOST_DIFFITY', context);
	await runAction('OPEN_HOST_URL_WINDOW', context);
	await runAction('OPEN_HOST_URL_DEV_SERVER', context);
	await runAction('OPEN_HOST_URL_STORYBOOK', context);
	await runAction('OPEN_HOST_URL_APP', context);
	await runAction('EDIT_HOST_URL_WINDOW', context);
	await runAction('EDIT_HOST_URL_DEV_SERVER', context);
	await runAction('EDIT_HOST_URL_STORYBOOK', context);
	await runAction('EDIT_HOST_URL_APP', context);
	await runAction('CYCLE_WORKMUX_STATUS', context);

	assert.equal(diffityOpened, 1);
	assert.deepEqual(openedSlots, [
		'window-url',
		'dev-web-server-url',
		'storybook-url',
		'app-url',
	]);
	assert.deepEqual(editedSlots, [
		'window-url',
		'dev-web-server-url',
		'storybook-url',
		'app-url',
	]);
	assert.equal(statusCycled, 1);
});

void test('browser keyboard is a target keyboard action', () => {
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_BROWSER_KEYBOARD'), true);
});

void test('browser actions menu action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_BROWSER_ACTIONS', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openBrowserActions: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_BROWSER_ACTIONS'), true);
});
