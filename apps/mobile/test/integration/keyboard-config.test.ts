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

void test('phone base keyboard review key taps code fix 2 and long-presses code fix 2 or 3', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const phoneBaseMacros = config.macrosByKeyboardId[phoneBaseKeyboard.id];
	assert.ok(phoneBaseMacros);

	const reviewMacro = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_rloop_code_fix',
	);
	const reviewMacro3 = phoneBaseMacros.find(
		(macro) => macro.id === 'cmd_rloop_code_fix_3',
	);

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
		macroId: 'cmd_rloop_code_fix',
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
