import assert from 'node:assert/strict';
import test from 'node:test';
import { commandPresets } from '../../src/lib/command-presets';

const expectedSkills = [
	'$test-driven-development',
	'$systematic-debugging',
	'$verification-before-completion',
	'$brainstorming',
	'$writing-plans',
	'$executing-plans',
	'$dispatching-parallel-agents',
	'$requesting-code-review',
	'$receiving-code-review',
	'$finishing-a-development-branch',
	'$writing-skills',
	'$using-superpowers',
];

void test('superpower submenu exposes text-only skill presets', () => {
	const submenu = commandPresets.find(
		(preset) => preset.type === 'submenu' && preset.label === 'superpower',
	);

	assert.ok(submenu);
	assert.equal(submenu.type, 'submenu');
	assert.deepEqual(
		submenu.presets.map((preset) => preset.label),
		expectedSkills,
	);

	for (const preset of submenu.presets) {
		assert.equal(preset.type, 'preset');
		assert.deepEqual(preset.steps, [{ type: 'text', data: preset.label }]);
	}
});
