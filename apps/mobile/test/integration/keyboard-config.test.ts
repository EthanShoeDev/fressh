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

void test('phone base keyboard review key sends code review and long-presses requesting review', () => {
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
	const requestingCodeReviewMacro = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_requesting_code_review',
	);

	assert.deepEqual(codeReviewMacro, {
		id: 'cmd_code_review',
		name: 'Command: code review',
		label: '$code-review',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$code-review",\n  "enter": true\n}',
	});
	assert.deepEqual(requestingCodeReviewMacro, {
		id: 'cmd_requesting_code_review',
		name: 'Command: requesting code review',
		label: '$requesting-code-review',
		category: 'Commands',
		script:
			'{\n  "type": "command",\n  "value": "$requesting-code-review",\n  "enter": true\n}',
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
					macroId: 'cmd_requesting_code_review',
					label: '$requesting-code-review',
					icon: null,
				},
			],
		},
	});
});

void test('phone base keyboard replaces raw dollar key with skill selector macro', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const rawDollarSlots = phoneBaseKeyboard.grid.flatMap((row) =>
		row.filter((slot) => slot?.type === 'text' && slot.text === '$'),
	);
	assert.deepEqual(rawDollarSlots, []);

	const phoneBaseMacros = config.macrosByKeyboardId[phoneBaseKeyboard.id];
	assert.ok(phoneBaseMacros);
	assert.deepEqual(
		phoneBaseMacros.find((macro) => macro.id === 'skill_selector'),
		{
			id: 'skill_selector',
			name: 'Skill selector',
			label: '$',
			category: 'Commands',
			script: '{\n  "type": "action",\n  "actionId": "OPEN_SKILL_SELECTOR"\n}',
		},
	);

	assert.deepEqual(phoneBaseKeyboard.grid[1]?.[8], {
		type: 'macro',
		macroId: 'skill_selector',
		label: '$',
		icon: null,
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
					bytes: [27, 91, 49, 59, 55, 68],
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
					bytes: [27, 91, 49, 59, 55, 67],
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
					bytes: [27, 91, 49, 59, 55, 68],
					label: 'Prev all',
					icon: null,
				},
				{
					type: 'bytes',
					bytes: [27, 91, 49, 59, 55, 67],
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

void test('phone base keyboard exposes explain, browser actions, and status actions', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	assert.ok(config.activeKeyboardIds.includes('browser_keyboard'));
	assert.deepEqual(phoneBaseKeyboard.grid[0]?.[1], {
		type: 'macro',
		macroId: 'cmd_plain_language',
		label: 'Explain',
		icon: null,
	});
	assert.deepEqual(phoneBaseKeyboard.grid[2]?.[2], {
		type: 'action',
		actionId: 'OPEN_BROWSER_ACTIONS',
		label: 'Browser',
		icon: 'ExternalLink',
	});
	assert.deepEqual(phoneBaseKeyboard.grid[1]?.[2], {
		type: 'action',
		actionId: 'CYCLE_WORKMUX_STATUS',
		label: 'Status',
		icon: 'Clock',
		longPress: {
			options: [
				{
					type: 'action',
					actionId: 'CYCLE_WORKMUX_STATUS',
					label: 'Status',
					icon: 'Clock',
				},
				{
					type: 'bytes',
					bytes: [27, 81],
					label: 'Hide',
					icon: null,
				},
			],
		},
	});
	assert.equal(phoneBaseKeyboard.grid.length, 3);
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
	assert.deepEqual(browserKeyboard.grid[0]?.slice(0, 7), [
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
			actionId: 'OPEN_HOST_DETECTED_AUTO',
			label: 'Open',
			icon: 'ExternalLink',
		},
		{
			type: 'action',
			actionId: 'OPEN_HOST_DETECTED_PICK',
			label: 'Pick',
			icon: 'List',
		},
	]);
	assert.deepEqual(browserKeyboard.grid[0]?.slice(7, 10), [null, null, null]);
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
	const browserKeyboardActionIds = browserKeyboard.grid.flatMap((row) =>
		row.flatMap((item) => (item?.type === 'action' ? [item.actionId] : [])),
	);
	assert.equal(browserKeyboardActionIds.includes('OPEN_HOST_URL_APP'), false);
	assert.deepEqual(config.macrosByKeyboardId.browser_keyboard, []);
});

void test('advanced keyboard omits consolidated host URL setter actions', () => {
	const config = getBundledShellConfig();
	const advancedKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'advanced_keyboard',
	);
	assert.ok(advancedKeyboard);

	assert.equal(advancedKeyboard.grid.length, 3);
	assert.deepEqual(advancedKeyboard.grid[0]?.slice(4, 5), [
		{
			type: 'action',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
			label: 'Issue',
			icon: 'CirclePlus',
		},
	]);
	assert.deepEqual(advancedKeyboard.grid[2]?.slice(0, 4), [
		null,
		null,
		null,
		null,
	]);

	const advancedActionIds = advancedKeyboard.grid.flatMap((row) =>
		row.flatMap((item) => (item?.type === 'action' ? [item.actionId] : [])),
	);

	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_WINDOW'), false);
	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_DEV_SERVER'), false);
	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_STORYBOOK'), false);
	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_APP'), false);
});
