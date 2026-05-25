import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parseMacroScript,
	runMacro,
	runSlotItem,
} from '../../src/lib/keyboard-runtime';
import { getBundledShellConfig } from '../../src/lib/shell-config';

void test('steps macros parse and delegate to the scheduled step runner', () => {
	const script = JSON.stringify({
		type: 'steps',
		steps: [
			{ type: 'text', data: '/review' },
			{ type: 'enter', delayMs: 280 },
			{ type: 'arrowDown', delayMs: 280 },
			{ type: 'enter', delayMs: 280 },
		],
	});

	const parsed = parseMacroScript(script);
	assert.deepEqual(parsed, {
		type: 'steps',
		steps: [
			{ type: 'text', data: '/review', delayMs: undefined, repeat: undefined },
			{ type: 'enter', delayMs: 280, repeat: undefined },
			{ type: 'arrowDown', delayMs: 280, repeat: undefined },
			{ type: 'enter', delayMs: 280, repeat: undefined },
		],
	});

	const sentTexts: string[] = [];
	const sentBytes: number[][] = [];
	const actions: string[] = [];
	let receivedSteps: unknown = null;

	runMacro(
		{
			id: 'cmd_review',
			name: 'Command: review',
			label: '/review',
			category: 'Commands',
			script,
		},
		{
			sendBytes: (bytes) => {
				sentBytes.push(Array.from(bytes));
			},
			sendText: (value) => {
				sentTexts.push(value);
			},
			runSteps: (steps) => {
				receivedSteps = steps;
			},
			onAction: (actionId) => {
				actions.push(actionId);
			},
		},
	);

	assert.deepEqual(receivedSteps, parsed?.type === 'steps' ? parsed.steps : null);
	assert.deepEqual(sentTexts, []);
	assert.deepEqual(sentBytes, []);
	assert.deepEqual(actions, []);
});

void test('phone base skill selector slot dispatches the open selector action', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const skillSelectorSlot = phoneBaseKeyboard.grid[1]?.[8];
	assert.ok(skillSelectorSlot);
	assert.equal(skillSelectorSlot.type, 'macro');
	assert.equal(skillSelectorSlot.macroId, 'skill_selector');

	const phoneBaseMacros = config.macrosByKeyboardId.phone_base;
	assert.ok(phoneBaseMacros);
	assert.ok(
		phoneBaseMacros.find((macro) => macro.id === skillSelectorSlot.macroId),
	);

	const sentTexts: string[] = [];
	const sentBytes: number[][] = [];
	const actions: string[] = [];
	let receivedSteps: unknown = null;

	runSlotItem(skillSelectorSlot, phoneBaseMacros, {
		sendBytes: (bytes) => {
			sentBytes.push(Array.from(bytes));
		},
		sendText: (value) => {
			sentTexts.push(value);
		},
		runSteps: (steps) => {
			receivedSteps = steps;
		},
		onAction: (actionId) => {
			actions.push(actionId);
		},
	});

	assert.deepEqual(actions, ['OPEN_SKILL_SELECTOR']);
	assert.deepEqual(sentTexts, []);
	assert.deepEqual(sentBytes, []);
	assert.equal(receivedSteps, null);
});
