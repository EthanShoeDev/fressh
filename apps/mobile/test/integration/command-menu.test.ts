import assert from 'node:assert/strict';
import test from 'node:test';
import {
	type CommandMenuEntry,
	type CommandPreset,
	getBundledShellConfig,
} from '../../src/lib/shell-config';

type CommandTreeNode = {
	label: string;
	type: CommandMenuEntry['type'];
	children?: CommandTreeNode[];
};

function commandTree(entries: CommandMenuEntry[]): CommandTreeNode[] {
	return entries.map((entry) => {
		if (entry.type !== 'submenu') {
			return { label: entry.label, type: entry.type };
		}
		return {
			label: entry.label,
			type: entry.type,
			children: commandTree(entry.entries),
		};
	});
}

function findPreset(
	entries: CommandMenuEntry[],
	path: readonly string[],
): CommandPreset {
	const [head, ...tail] = path;
	assert.ok(head);
	const entry = entries.find((candidate) => candidate.label === head);
	assert.ok(entry, `Missing command menu entry ${path.join(' > ')}`);
	if (tail.length === 0) {
		assert.equal(entry.type, 'preset');
		return entry;
	}
	assert.equal(entry.type, 'submenu');
	return findPreset(entry.entries, tail);
}

void test('bundled command menu exposes the approved Issue 91 tree', () => {
	assert.deepEqual(commandTree(getBundledShellConfig().commandMenus), [
		{ label: '/new', type: 'preset' },
		{
			label: 'superpower',
			type: 'submenu',
			children: [
				{ label: '$test-driven-development', type: 'preset' },
				{ label: '$systematic-debugging', type: 'preset' },
				{ label: '$verification-before-completion', type: 'preset' },
				{ label: '$brainstorming', type: 'preset' },
				{ label: '$writing-plans', type: 'preset' },
				{ label: '$executing-plans', type: 'preset' },
				{ label: '$dispatching-parallel-agents', type: 'preset' },
				{ label: '$subagent-driven-development', type: 'preset' },
				{ label: '$subagent-driven-development-ce1', type: 'preset' },
				{ label: '$requesting-code-review', type: 'preset' },
				{ label: '$receiving-code-review', type: 'preset' },
				{ label: '$finishing-a-development-branch', type: 'preset' },
				{ label: '$writing-skills', type: 'preset' },
				{ label: '$using-superpowers', type: 'preset' },
			],
		},
		{
			label: 'features',
			type: 'submenu',
			children: [
				{ label: '$work-on-bug', type: 'preset' },
				{ label: '$work-on-bug-reflect', type: 'preset' },
				{ label: '$work-on-issue', type: 'preset' },
				{ label: '$dev-work-on-commission-bug', type: 'preset' },
				{ label: '$work-step-by-step', type: 'preset' },
				{ label: '$tldr', type: 'preset' },
				{ label: '/rloop-review', type: 'preset' },
				{ label: '$oracle-ask', type: 'preset' },
			],
		},
		{
			label: 'Git',
			type: 'submenu',
			children: [
				{ label: '$git-pr', type: 'preset' },
				{ label: 'dev pull status', type: 'preset' },
				{ label: 'git checkout dev', type: 'preset' },
				{ label: 'git pull', type: 'preset' },
				{ label: 'git status', type: 'preset' },
				{ label: 'clear', type: 'preset' },
			],
		},
		{
			label: 'mdev',
			type: 'submenu',
			children: [
				{ label: 'Request a Feature', type: 'action' },
				{ label: 'Open Workspace', type: 'preset' },
				{ label: 'Close Workspace', type: 'preset' },
				{ label: 'Rename Workspace', type: 'preset' },
				{ label: 'codex auth refresh new', type: 'preset' },
				{ label: 'codex auth refresh', type: 'preset' },
			],
		},
		{
			label: 'core8',
			type: 'submenu',
			children: [
				{ label: 'yarn cq', type: 'preset' },
				{ label: 'yarn test:ci', type: 'preset' },
				{ label: 'core8 env fix', type: 'preset' },
				{ label: 'core8 jobs switch T0', type: 'preset' },
				{ label: 'core8 env switch staging', type: 'preset' },
			],
		},
	]);
});

void test('mdev submenu routes feature request through a native app action', () => {
	const mdev = getBundledShellConfig().commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);
	assert.ok(mdev);
	assert.equal(mdev.type, 'submenu');

	assert.deepEqual(mdev.entries[0], {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	});
});

void test('mdev workspace presets run existing tmux workspace commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(findPreset(commandMenus, ['mdev', 'Open Workspace']), {
		type: 'preset',
		label: 'Open Workspace',
		steps: [
			{ type: 'text', data: 'mdev tmux open-workspace' },
			{ type: 'enter' },
		],
	});
	assert.deepEqual(findPreset(commandMenus, ['mdev', 'Close Workspace']), {
		type: 'preset',
		label: 'Close Workspace',
		steps: [
			{ type: 'text', data: 'mdev tmux workspace close' },
			{ type: 'enter' },
		],
	});
	assert.deepEqual(findPreset(commandMenus, ['mdev', 'Rename Workspace']), {
		type: 'preset',
		label: 'Rename Workspace',
		steps: [
			{ type: 'text', data: 'mdev tmux workspace prompt-rename' },
			{ type: 'enter' },
		],
	});
});

void test('codex auth refresh variants intentionally share the same command for now', () => {
	const commandMenus = getBundledShellConfig().commandMenus;
	const expected = [
		{ type: 'text', data: 'mdev codex auth refresh' },
		{ type: 'enter' },
	];

	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'codex auth refresh new']).steps,
		expected,
	);
	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'codex auth refresh']).steps,
		expected,
	);
});

void test('core8 submenu owns repo quality commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(findPreset(commandMenus, ['core8', 'yarn cq']), {
		type: 'preset',
		label: 'yarn cq',
		steps: [{ type: 'text', data: 'yarn cq' }, { type: 'enter' }],
	});
	assert.deepEqual(findPreset(commandMenus, ['core8', 'yarn test:ci']), {
		type: 'preset',
		label: 'yarn test:ci',
		steps: [{ type: 'text', data: 'yarn test:ci' }, { type: 'enter' }],
	});
	assert.deepEqual(findPreset(commandMenus, ['core8', 'core8 jobs switch T0']), {
		type: 'preset',
		label: 'core8 jobs switch T0',
		steps: [{ type: 'text', data: './bin/core8 jobs switch T0' }],
	});
});
