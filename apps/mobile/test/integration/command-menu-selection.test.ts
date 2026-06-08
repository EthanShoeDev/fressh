import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchCommandMenuSelection } from '../../src/lib/command-menu-selection';
import { type CommandMenuEntry } from '../../src/lib/shell-config';

void test('command menu selection dispatch opens submenu entries only', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'submenu',
		label: 'mdev',
		entries: [],
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
	});

	assert.deepEqual(calls, ['submenu:mdev']);
});

void test('command menu selection dispatch selects preset entries only', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'preset',
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
	});

	assert.deepEqual(calls, ['preset:/new']);
});

void test('command menu selection dispatch closes before native actions', () => {
	const calls: string[] = [];
	const entry: CommandMenuEntry = {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	};

	dispatchCommandMenuSelection(entry, {
		onSubmenu: (menu) => calls.push(`submenu:${menu.label}`),
		onPreset: (preset) => calls.push(`preset:${preset.label}`),
		onClose: () => calls.push('close'),
		onAction: (actionId) => calls.push(`action:${actionId}`),
	});

	assert.deepEqual(calls, ['close', 'action:OPEN_REPO_FEATURE_REQUEST']);
});
