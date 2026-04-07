import assert from 'node:assert/strict';
import test from 'node:test';
import { MACROS_BY_KEYBOARD_ID } from '../../src/generated/keyboard-config';
import { keyboard_phone_base } from '../../src/generated/keyboards/phone_base';

void test('phone base keyboard exposes a continue command key between approve and shift-tab', () => {
	const continueMacro = MACROS_BY_KEYBOARD_ID.phone_base.find(
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

	const secondRow = keyboard_phone_base.grid[1];
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
