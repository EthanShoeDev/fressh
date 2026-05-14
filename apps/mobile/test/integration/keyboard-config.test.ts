import assert from 'node:assert/strict';
import test from 'node:test';
import { getBundledShellConfig } from '../../src/lib/shell-config';

void test('phone base keyboard exposes a continue command key between approve and shift-tab', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const phoneBaseMacros = config.macrosByKeyboardId[phoneBaseKeyboard.id];
	assert.ok(phoneBaseMacros);

	const continueMacro = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_continue',
	);

	assert.deepEqual(continueMacro, {
		id: 'cmd_continue',
		name: 'Command: continue',
		label: 'continue',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "continue",\n  "enter": true\n}',
	});

	const secondRow = phoneBaseKeyboard.grid[1];
	assert.ok(secondRow);
	assert.equal(secondRow[3]?.type, 'macro');
	assert.equal(secondRow[3]?.label, 'approve');
	assert.deepEqual(secondRow[4], {
		type: 'macro',
		macroId: 'cmd_continue',
		label: 'continue',
		icon: null,
	});
	assert.equal(secondRow[5]?.type, 'bytes');
	assert.equal(secondRow[5]?.label, 'S-Tab');
});

void test('phone base keyboard review key taps code review and long-presses code fix 2 or 3', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const phoneBaseMacros = config.macrosByKeyboardId[phoneBaseKeyboard.id];
	assert.ok(phoneBaseMacros);

	const codeReviewMacro = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_code_review',
	);
	const reviewMacro = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_rloop_code_fix',
	);
	const reviewMacro3 = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_rloop_code_fix_3',
	);

	assert.deepEqual(codeReviewMacro, {
		id: 'cmd_code_review',
		name: 'Command: code review',
		label: '$code-review',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$code-review",\n  "enter": true\n}',
	});
	assert.deepEqual(reviewMacro, {
		id: 'cmd_rloop_code_fix',
		name: 'Command: rloop code fix 2',
		label: '$rloop-code-fix2',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$rloop-code-fix2",\n  "enter": true\n}',
	});
	assert.deepEqual(reviewMacro3, {
		id: 'cmd_rloop_code_fix_3',
		name: 'Command: rloop code fix 3',
		label: '$rloop-code-fix3',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$rloop-code-fix3",\n  "enter": true\n}',
	});

	const thirdRow = phoneBaseKeyboard.grid[2];
	assert.ok(thirdRow);
	assert.deepEqual(thirdRow[6], {
		type: 'macro',
		macroId: 'cmd_code_review',
		label: 'Review',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'cmd_rloop_code_fix',
					label: '$rloop-code-fix2',
					icon: null,
				},
				{
					type: 'macro',
					macroId: 'cmd_rloop_code_fix_3',
					label: '$rloop-code-fix3',
					icon: null,
				},
			],
		},
	});
});

void test('phone base keyboard exposes long-press navigation options on arrows and window', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const secondRow = phoneBaseKeyboard.grid[1];
	const thirdRow = phoneBaseKeyboard.grid[2];
	assert.ok(secondRow);
	assert.ok(thirdRow);

	assert.deepEqual(secondRow[0], {
		type: 'bytes',
		bytes: [27, 91, 68],
		label: 'ARROW_LEFT',
		icon: 'ArrowLeft',
		longPress: {
			options: [
				{
					type: 'bytes',
					bytes: [27, 91, 68],
					label: 'ARROW_LEFT',
					icon: 'ArrowLeft',
				},
				{
					type: 'bytes',
					bytes: [27, 91, 53, 126],
					label: 'PAGE_UP',
					icon: 'ChevronsUp',
				},
				{
					type: 'bytes',
					bytes: [2, 112],
					label: 'Prev all',
					icon: null,
				},
			],
		},
	});

	assert.deepEqual(secondRow[1], {
		type: 'bytes',
		bytes: [27, 91, 67],
		label: 'ARROW_RIGHT',
		icon: 'ArrowRight',
		longPress: {
			options: [
				{
					type: 'bytes',
					bytes: [27, 91, 67],
					label: 'ARROW_RIGHT',
					icon: 'ArrowRight',
				},
				{
					type: 'bytes',
					bytes: [27, 91, 54, 126],
					label: 'PAGE_DOWN',
					icon: 'ChevronsDown',
				},
				{
					type: 'bytes',
					bytes: [2, 110],
					label: 'Next all',
					icon: null,
				},
			],
		},
	});

	assert.deepEqual(phoneBaseKeyboard.grid[0]?.[6], {
		type: 'bytes',
		bytes: [27, 91, 49, 59, 53, 67],
		label: 'Window',
		icon: 'AppWindow',
		span: 2,
		longPress: {
			options: [
				{
					type: 'bytes',
					bytes: [27, 91, 49, 59, 53, 67],
					label: 'Window',
					icon: 'AppWindow',
				},
				{
					type: 'bytes',
					bytes: [2, 112],
					label: 'Prev all',
					icon: null,
				},
				{
					type: 'bytes',
					bytes: [2, 110],
					label: 'Next all',
					icon: null,
				},
				{
					type: 'macro',
					macroId: 'alt_w',
					label: 'Alt-w',
					icon: null,
				},
			],
		},
	});
});

void test('bundled keyboards do not expose tmux history actions', () => {
	const config = getBundledShellConfig();

	const historySlots = config.keyboards.flatMap((keyboard) =>
		keyboard.grid.flatMap((row) =>
			row.filter(
				(slot) =>
					slot?.type === 'action' && slot.actionId === 'OPEN_TMUX_HISTORY',
			),
		),
	);

	assert.deepEqual(historySlots, []);
});

void test('phone base keyboard exposes browser and status actions', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	assert.ok(config.activeKeyboardIds.includes('browser_keyboard'));
	assert.deepEqual(phoneBaseKeyboard.grid[3]?.[0], {
		type: 'macro',
		macroId: 'cmd_plain_language',
		label: 'Explain',
		icon: null,
	});
	assert.deepEqual(phoneBaseKeyboard.grid[3]?.[1], {
		type: 'action',
		actionId: 'OPEN_BROWSER_KEYBOARD',
		label: 'Browser',
		icon: 'ExternalLink',
	});
	assert.deepEqual(phoneBaseKeyboard.grid[3]?.[2], {
		type: 'action',
		actionId: 'CYCLE_WORKMUX_STATUS',
		label: 'Status',
		icon: 'Clock',
	});
});

void test('browser keyboard exposes host navigation actions', () => {
	const config = getBundledShellConfig();
	const browserKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'browser_keyboard',
	);
	assert.ok(browserKeyboard);

	assert.equal(browserKeyboard.builtIn, true);
	assert.equal(browserKeyboard.active, true);
	assert.equal(browserKeyboard.rotationOrder, 2);
	assert.equal(browserKeyboard.grid.length, 4);
	assert.deepEqual(
		browserKeyboard.grid.map((row) => row.length),
		[10, 10, 10, 10],
	);
	assert.deepEqual(browserKeyboard.grid[0]?.slice(0, 6), [
		{
			type: 'action',
			actionId: 'OPEN_MAIN_MENU',
			label: 'Back',
			icon: 'X',
		},
		{
			type: 'action',
			actionId: 'OPEN_HOST_DIFFITY',
			label: 'Diff',
			icon: 'GitCompare',
		},
		{
			type: 'action',
			actionId: 'OPEN_HOST_URL_WINDOW',
			label: 'URL',
			icon: 'Link',
		},
		{
			type: 'action',
			actionId: 'OPEN_HOST_URL_DEV_SERVER',
			label: 'Web',
			icon: 'Globe',
		},
		{
			type: 'action',
			actionId: 'OPEN_HOST_URL_STORYBOOK',
			label: 'Story',
			icon: 'BookOpen',
		},
		{
			type: 'action',
			actionId: 'OPEN_HOST_URL_APP',
			label: 'App',
			icon: 'PanelTop',
		},
	]);
	assert.deepEqual(browserKeyboard.grid[0]?.slice(6, 10), [
		null,
		null,
		null,
		null,
	]);
	for (const row of browserKeyboard.grid.slice(1, 4)) {
		assert.deepEqual(row, [
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		]);
	}
	assert.deepEqual(config.macrosByKeyboardId.browser_keyboard, []);
});

void test('advanced keyboard exposes host URL setter actions', () => {
	const config = getBundledShellConfig();
	const advancedKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'advanced_keyboard',
	);
	assert.ok(advancedKeyboard);

	assert.deepEqual(advancedKeyboard.grid[3]?.slice(0, 4), [
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_WINDOW',
			label: 'Set URL',
			icon: 'Link',
		},
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_DEV_SERVER',
			label: 'Set Web',
			icon: 'Globe',
		},
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_STORYBOOK',
			label: 'Set Story',
			icon: 'BookOpen',
		},
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_APP',
			label: 'Set App',
			icon: 'PanelTop',
		},
	]);
});
