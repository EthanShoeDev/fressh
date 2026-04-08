import assert from 'node:assert/strict';
import test from 'node:test';
import { getBundledShellConfig } from '../../src/lib/shell-config';

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
	const submenu = getBundledShellConfig().commandMenus.find(
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

void test('top-level command list includes $tldr and excludes /pr and rloop code fix', () => {
	const topLevelLabels = getBundledShellConfig().commandMenus.map(
		(entry) => entry.label,
	);

	assert.ok(topLevelLabels.includes('$tldr'));
	assert.equal(topLevelLabels.includes('/pr'), false);
	assert.equal(topLevelLabels.includes('$rloop-code-fix'), false);
	assert.equal(topLevelLabels.includes('$rloop-code-fix2'), false);
});

void test('git submenu includes $diff as an enter command', () => {
	const submenu = getBundledShellConfig().commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'Git',
	);

	assert.ok(submenu);
	assert.equal(submenu.type, 'submenu');

	const diffPreset = submenu.presets.find(
		(entry) => entry.type === 'preset' && entry.label === '$diff',
	);

	assert.deepEqual(diffPreset, {
		type: 'preset',
		label: '$diff',
		steps: [{ type: 'text', data: '$diff' }, { type: 'enter' }],
	});
});
