import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	getKeyboardActionTarget,
	parseShellConfigString,
	resolveActiveOneShotReturnKeyboardId,
} from '../../src/lib/shell-config';

const bundledConfigText = readFileSync(
	path.resolve(import.meta.dirname, '../../config/shell-config.json'),
	'utf8',
);

void test('bundled advanced keyboard stays selected until explicit back action', () => {
	const config = parseShellConfigString(bundledConfigText);
	const availableKeyboardIds = new Set(config.activeKeyboardIds);

	assert.equal(
		resolveActiveOneShotReturnKeyboardId(
			config,
			availableKeyboardIds,
			'advanced_keyboard',
		),
		null,
	);
	assert.equal(
		getKeyboardActionTarget(config, 'OPEN_ADVANCED_KEYBOARD'),
		'advanced_keyboard',
	);
	assert.equal(
		getKeyboardActionTarget(config, 'OPEN_BROWSER_KEYBOARD'),
		'browser_keyboard',
	);
	assert.equal(getKeyboardActionTarget(config, 'OPEN_MAIN_MENU'), 'phone_base');
});

void test('one-shot return uses the latest active routing state', () => {
	const config = parseShellConfigString(bundledConfigText);
	const updatedConfig = {
		...config,
		activeKeyboardIds: ['advanced_keyboard'],
		keyboardRouting: {
			actionTargets: {},
			oneShotReturnByKeyboardId: {},
		},
	};

	assert.equal(
		resolveActiveOneShotReturnKeyboardId(
			updatedConfig,
			new Set(updatedConfig.activeKeyboardIds),
			'advanced_keyboard',
		),
		null,
	);
});
