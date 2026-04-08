import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	parseShellConfigString,
	resolveActiveOneShotReturnKeyboardId,
} from '../../src/lib/shell-config';

const bundledConfigText = readFileSync(
	path.resolve(import.meta.dirname, '../../config/shell-config.json'),
	'utf8',
);

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
