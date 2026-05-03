import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	parseShellConfigData,
	parseShellConfigString,
	resolveSelectedKeyboardId,
} from '../../src/lib/shell-config';

const bundledConfigText = readFileSync(
	path.resolve(import.meta.dirname, '../../config/shell-config.json'),
	'utf8',
);

void test('bundled runtime shell config parses with keyboards and command menus', () => {
	const config = parseShellConfigString(bundledConfigText);
	const rawConfig = JSON.parse(bundledConfigText) as Record<string, unknown>;

	assert.ok(config.version);
	assert.ok(config.updatedAt);
	assert.ok(config.keyboards.length > 0);
	assert.ok(config.commandMenus.length > 0);
	assert.ok(rawConfig.keyboardRouting);
	assert.deepEqual(
		(rawConfig.keyboardRouting as {
			oneShotReturnByKeyboardId?: Record<string, string>;
		}).oneShotReturnByKeyboardId,
		{ advanced_keyboard: 'phone_base' },
	);
	assert.equal(resolveSelectedKeyboardId(config, 'missing-keyboard'), config.defaultKeyboardId);
});

void test('runtime shell config falls back to default when selected keyboard is inactive', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.activeKeyboardIds = ['phone_base'];
	config.keyboardRouting = {
		actionTargets: {},
		oneShotReturnByKeyboardId: {},
	};

	const parsed = parseShellConfigData(config);

	assert.equal(resolveSelectedKeyboardId(parsed, 'advanced_keyboard'), 'phone_base');
});

void test('runtime shell config rejects duplicate active keyboard ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.activeKeyboardIds = ['phone_base', 'phone_base'];
	config.keyboardRouting = {
		actionTargets: {},
		oneShotReturnByKeyboardId: {},
	};

	assert.throws(() => parseShellConfigData(config), /Duplicate active keyboard id phone_base/);
});

	void test('runtime shell config rejects missing macro references', () => {
		const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
		const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
		const firstKeyboard = keyboards[0];
		assert.ok(firstKeyboard);
		const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'missing_macro',
		label: 'Missing',
		icon: null,
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /missing_macro/);
});

void test('runtime shell config rejects unknown action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
		assert.ok(firstKeyboard);
		const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'NOT_A_REAL_ACTION',
		label: 'Broken',
		icon: null,
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});

void test('runtime shell config accepts long-press macro options on a key', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'cmd_fix',
		label: 'Fix',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'cmd_fix',
					label: 'fix',
					icon: null,
				},
				{
					type: 'macro',
					macroId: 'cmd_yes',
					label: 'yes',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	const parsed = parseShellConfigData(config);
	const slot = parsed.keyboards[0]?.grid[0]?.[0];
	assert.equal(slot?.type, 'macro');
	assert.deepEqual(slot?.longPress, {
		options: [
			{ type: 'macro', macroId: 'cmd_fix', label: 'fix', icon: null },
			{ type: 'macro', macroId: 'cmd_yes', label: 'yes', icon: null },
		],
	});
});

void test('runtime shell config rejects missing macro references in long-press options', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'macro',
		macroId: 'cmd_fix',
		label: 'Fix',
		icon: null,
		longPress: {
			options: [
				{
					type: 'macro',
					macroId: 'missing_long_press_macro',
					label: 'Missing',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(
		() => parseShellConfigData(config),
		/missing_long_press_macro/,
	);
});

void test('runtime shell config rejects unknown action ids in long-press options', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	const keyboards = structuredClone(config.keyboards) as Record<string, unknown>[];
	const firstKeyboard = keyboards[0];
	assert.ok(firstKeyboard);
	const grid = structuredClone(firstKeyboard.grid) as unknown[][];
	grid[0]![0] = {
		type: 'action',
		actionId: 'PASTE_CLIPBOARD',
		label: 'Paste',
		icon: null,
		longPress: {
			options: [
				{
					type: 'action',
					actionId: 'NOT_A_REAL_ACTION',
					label: 'Broken',
					icon: null,
				},
			],
		},
	};
	firstKeyboard.grid = grid;
	config.keyboards = keyboards;

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});
