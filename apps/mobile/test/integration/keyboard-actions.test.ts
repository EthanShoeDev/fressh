import assert from 'node:assert/strict';
import test from 'node:test';
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../../src/lib/host-browser-actions';
import {
	CONFIG_SUPPORTED_ACTION_IDS,
	KNOWN_ACTION_IDS,
	WORKMUX_KEYBOARD_COMPATIBILITY_ACTION_IDS,
	WORKMUX_KEYBOARD_ACTION_IDS,
	WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE,
	createWorkmuxKeyboardCommandRunner,
	formatWorkmuxKeyboardCommandFailureMessage,
	runAction,
	type WorkmuxKeyboardCommand,
} from '../../src/lib/keyboard-actions';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

const EXPECTED_WORKMUX_KEYBOARD_ACTIONS = [
	['WORKMUX_FOCUS_CLAUDE', { type: 'focus', target: 'claude' }],
	['WORKMUX_FOCUS_GIT', { type: 'focus', target: 'git' }],
	['WORKMUX_FOCUS_CODEX', { type: 'focus', target: 'codex' }],
	['WORKMUX_FOCUS_BASH', { type: 'focus', target: 'bash' }],
	['WORKMUX_FOCUS_PREV', { type: 'focus', target: 'prev' }],
	['WORKMUX_FOCUS_NEXT', { type: 'focus', target: 'next' }],
	[
		'WORKMUX_FOCUS_TOGGLE_GIT_BASH',
		{ type: 'focus', target: 'toggle-git-bash' },
	],
	['WORKMUX_NAV_PREV', { type: 'nav', action: 'prev' }],
	['WORKMUX_NAV_NEXT', { type: 'nav', action: 'next' }],
	['WORKMUX_NAV_PREV_ALL', { type: 'nav', action: 'prev-all' }],
	['WORKMUX_NAV_NEXT_ALL', { type: 'nav', action: 'next-all' }],
] as const satisfies readonly (readonly [string, WorkmuxKeyboardCommand])[];

void test('keyboard navigation actions use runtime-configured targets instead of hardcoded ids', async () => {
	const selectedKeyboardIds: string[] = [];

	await runAction('OPEN_ADVANCED_KEYBOARD', {
		availableKeyboardIds: new Set(['custom_advanced']),
		selectKeyboard: (id) => {
			selectedKeyboardIds.push(id);
		},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		resolveKeyboardActionTarget: (actionId: string) =>
			actionId === 'OPEN_ADVANCED_KEYBOARD' ? 'custom_advanced' : null,
	} as Parameters<typeof runAction>[1]);

	assert.deepEqual(selectedKeyboardIds, ['custom_advanced']);
});

void test('tmux history is not a known keyboard action', () => {
	assert.equal(
		KNOWN_ACTION_IDS.includes(
			'OPEN_TMUX_HISTORY' as (typeof KNOWN_ACTION_IDS)[number],
		),
		false,
	);
	assert.equal(
		KNOWN_ACTION_IDS.includes(
			'CYCLE_TMUX_WINDOW' as (typeof KNOWN_ACTION_IDS)[number],
		),
		false,
	);
	assert.equal(
		CONFIG_SUPPORTED_ACTION_IDS.includes(
			'CYCLE_TMUX_WINDOW' as (typeof CONFIG_SUPPORTED_ACTION_IDS)[number],
		),
		false,
	);
});

void test('stale keyboard target actions are not supported', () => {
	for (const actionId of ['OPEN_SECONDARY_MENU', 'OPEN_KEYBOARD_MENU']) {
		assert.equal(
			KNOWN_ACTION_IDS.includes(actionId as (typeof KNOWN_ACTION_IDS)[number]),
			false,
		);
		assert.equal(
			CONFIG_SUPPORTED_ACTION_IDS.includes(
				actionId as (typeof CONFIG_SUPPORTED_ACTION_IDS)[number],
			),
			false,
		);
	}
});

void test('Wispr text action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_WISPR_TEXT_EDITOR', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openWisprTextEditor: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
});

void test('skill selector action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_SKILL_SELECTOR', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openSkillSelector: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
});

void test('repo feature request action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_REPO_FEATURE_REQUEST', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openRepoFeatureRequest: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
});

void test('host browser actions delegate to action context callbacks', async () => {
	const openedSlots: string[] = [];
	const editedSlots: string[] = [];
	const detectedCalls: string[] = [];
	let diffityOpened = 0;

	const context = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openHostDiffity: () => {
			diffityOpened += 1;
		},
		openHostUrlSlot: (slot: string) => {
			openedSlots.push(slot);
		},
		editHostUrlSlot: (slot: string) => {
			editedSlots.push(slot);
		},
		openHostDetected: (mode: string) => {
			detectedCalls.push(mode);
		},
	} as Parameters<typeof runAction>[1];

	await runAction('OPEN_HOST_DIFFITY', context);
	await runAction('OPEN_HOST_URL_WINDOW', context);
	await runAction('OPEN_HOST_URL_DEV_SERVER', context);
	await runAction('OPEN_HOST_URL_STORYBOOK', context);
	await runAction('OPEN_HOST_URL_APP', context);
	await runAction('OPEN_HOST_DETECTED_AUTO', context);
	await runAction('OPEN_HOST_DETECTED_PICK', context);
	await runAction('EDIT_HOST_URL_WINDOW', context);
	await runAction('EDIT_HOST_URL_DEV_SERVER', context);
	await runAction('EDIT_HOST_URL_STORYBOOK', context);
	await runAction('EDIT_HOST_URL_APP', context);

	assert.equal(diffityOpened, 1);
	assert.deepEqual(openedSlots, [
		'window-url',
		'dev-web-server-url',
		'storybook-url',
		'app-url',
	]);
	assert.deepEqual(detectedCalls, ['auto', 'pick']);
	assert.deepEqual(editedSlots, [
		'window-url',
		'dev-web-server-url',
		'storybook-url',
		'app-url',
	]);
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_HOST_DETECTED_AUTO'), true);
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_HOST_DETECTED_PICK'), true);
	assert.equal(
		CONFIG_SUPPORTED_ACTION_IDS.includes('OPEN_HOST_DETECTED_AUTO'),
		true,
	);
	assert.equal(
		CONFIG_SUPPORTED_ACTION_IDS.includes('OPEN_HOST_DETECTED_PICK'),
		true,
	);
});

void test('browser keyboard is a target keyboard action', () => {
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_BROWSER_KEYBOARD'), true);
});

void test('browser actions menu action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_BROWSER_ACTIONS', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openBrowserActions: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_BROWSER_ACTIONS'), true);
});

void test('Workmux keyboard actions delegate semantic commands without sending bytes', async () => {
	const commands: WorkmuxKeyboardCommand[] = [];
	let sentBytes = 0;

	const context = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {
			sentBytes += 1;
		},
		pasteClipboard: async () => {},
		copySelection: () => {},
		runWorkmuxKeyboardCommand: async (command: WorkmuxKeyboardCommand) => {
			commands.push(command);
			return { status: 'handled' };
		},
	} as Parameters<typeof runAction>[1];

	for (const [actionId] of EXPECTED_WORKMUX_KEYBOARD_ACTIONS) {
		await runAction(actionId, context);
	}

	assert.deepEqual(
		commands,
		EXPECTED_WORKMUX_KEYBOARD_ACTIONS.map(([, command]) => command),
	);
	assert.equal(sentBytes, 0);
	assert.deepEqual(
		WORKMUX_KEYBOARD_ACTION_IDS,
		EXPECTED_WORKMUX_KEYBOARD_ACTIONS.map(([actionId]) => actionId),
	);
	for (const [actionId] of EXPECTED_WORKMUX_KEYBOARD_ACTIONS) {
		assert.equal(
			KNOWN_ACTION_IDS.includes(actionId as (typeof KNOWN_ACTION_IDS)[number]),
			true,
		);
	}
});

void test('legacy Workmux status action remains a config compatibility alias', async () => {
	const commands: WorkmuxKeyboardCommand[] = [];

	await runAction('CYCLE_WORKMUX_STATUS', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		runWorkmuxKeyboardCommand: async (command: WorkmuxKeyboardCommand) => {
			commands.push(command);
			return { status: 'handled' };
		},
	} as Parameters<typeof runAction>[1]);

	assert.deepEqual(commands, [{ type: 'nav', action: 'next-all' }]);
	assert.deepEqual(WORKMUX_KEYBOARD_COMPATIBILITY_ACTION_IDS, [
		'CYCLE_WORKMUX_STATUS',
	]);
	assert.equal(
		WORKMUX_KEYBOARD_ACTION_IDS.includes(
			'CYCLE_WORKMUX_STATUS' as (typeof WORKMUX_KEYBOARD_ACTION_IDS)[number],
		),
		false,
	);
	assert.equal(
		KNOWN_ACTION_IDS.includes(
			'CYCLE_WORKMUX_STATUS' as (typeof KNOWN_ACTION_IDS)[number],
		),
		true,
	);
	assert.equal(
		CONFIG_SUPPORTED_ACTION_IDS.includes(
			'CYCLE_WORKMUX_STATUS' as (typeof CONFIG_SUPPORTED_ACTION_IDS)[number],
		),
		true,
	);
});

void test('Workmux runAction waits for command handling and preserves Promise<void>', async () => {
	const commandBlock = deferred<{ status: 'handled' }>();
	let settled = false;
	const promise = runAction('WORKMUX_NAV_NEXT', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		runWorkmuxKeyboardCommand: async () => commandBlock.promise,
	} as Parameters<typeof runAction>[1]).then((result) => {
		settled = true;
		return result;
	});

	await Promise.resolve();
	assert.equal(settled, false);
	commandBlock.resolve({ status: 'handled' });
	assert.equal(await promise, undefined);
	assert.equal(settled, true);
});

void test('Workmux keyboard failure copy preserves local precondition failures', () => {
	assert.equal(
		formatWorkmuxKeyboardCommandFailureMessage({
			errorMessage: WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE,
			formatRemoteFailureMessage: () => WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		}),
		WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE,
	);
	assert.equal(
		formatWorkmuxKeyboardCommandFailureMessage({
			errorMessage: HOST_BROWSER_NO_CONNECTION_MESSAGE,
			formatRemoteFailureMessage: () => WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		}),
		HOST_BROWSER_NO_CONNECTION_MESSAGE,
	);
	assert.equal(
		formatWorkmuxKeyboardCommandFailureMessage({
			errorMessage: 'mdev: command not found',
			formatRemoteFailureMessage: () => WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		}),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
});

void test('Workmux keyboard command runner builds app commands and serializes execution', async () => {
	const firstBlock = deferred<void>();
	const calls: { command: string; timeoutMs: number }[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => ' work ',
		runHostCommand: async (command, timeoutMs) => {
			calls.push({ command, timeoutMs });
			if (calls.length === 1) await firstBlock.promise;
		},
		showFailure: () => {},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	const first = runner.run({ type: 'focus', target: 'claude' });
	const second = runner.run({ type: 'nav', action: 'next' });
	await Promise.resolve();
	assert.deepEqual(calls, [
		{
			command: "mdev tmux app focus 'claude' --session 'work'",
			timeoutMs: 10_000,
		},
	]);

	firstBlock.resolve(undefined);
	assert.deepEqual(await Promise.all([first, second]), [
		{ status: 'handled' },
		{ status: 'handled' },
	]);

	assert.deepEqual(calls, [
		{
			command: "mdev tmux app focus 'claude' --session 'work'",
			timeoutMs: 10_000,
		},
		{
			command: "mdev tmux app nav 'next' --session 'work'",
			timeoutMs: 10_000,
		},
	]);
});

void test('Workmux keyboard command runner bounds pending repeated commands to the latest command', async () => {
	const firstBlock = deferred<void>();
	const calls: string[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => 'main',
		runHostCommand: async (command) => {
			calls.push(command);
			if (calls.length === 1) await firstBlock.promise;
		},
		showFailure: () => {},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	const first = runner.run({ type: 'nav', action: 'prev' });
	const queued: ReturnType<typeof runner.run>[] = [];
	for (let index = 0; index < 1_000; index += 1) {
		queued.push(
			runner.run(
				index === 999
					? { type: 'focus', target: 'bash' }
					: { type: 'nav', action: 'next' },
			),
		);
	}

	await Promise.resolve();
	assert.deepEqual(calls, ["mdev tmux app nav 'prev' --session 'main'"]);

	firstBlock.resolve(undefined);
	const results = await Promise.all([first, ...queued]);

	assert.deepEqual(calls, [
		"mdev tmux app nav 'prev' --session 'main'",
		"mdev tmux app focus 'bash' --session 'main'",
	]);
	assert.deepEqual(results, [
		{ status: 'handled' },
		...Array.from({ length: 999 }, () => ({ status: 'superseded' })),
		{ status: 'handled' },
	]);
});

void test('Workmux keyboard command runner reads live dependencies for pending commands', async () => {
	const firstBlock = deferred<void>();
	const calls: { source: string; command: string }[] = [];
	let sessionName = 'old';
	let runHostCommand = async (command: string) => {
		calls.push({ source: 'old', command });
		if (calls.length === 1) await firstBlock.promise;
	};
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => sessionName,
		runHostCommand: (command) => runHostCommand(command),
		showFailure: () => {},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	const first = runner.run({ type: 'focus', target: 'git' });
	const second = runner.run({ type: 'focus', target: 'bash' });
	await Promise.resolve();
	sessionName = 'new';
	runHostCommand = async (command: string) => {
		calls.push({ source: 'new', command });
	};
	firstBlock.resolve(undefined);
	assert.deepEqual(await Promise.all([first, second]), [
		{ status: 'handled' },
		{ status: 'handled' },
	]);

	assert.deepEqual(calls, [
		{
			source: 'old',
			command: "mdev tmux app focus 'git' --session 'old'",
		},
		{
			source: 'new',
			command: "mdev tmux app focus 'bash' --session 'new'",
		},
	]);
});

void test('Workmux keyboard command runner reads live enabled state for pending commands', async () => {
	const firstBlock = deferred<void>();
	const calls: string[] = [];
	const failures: string[] = [];
	let tmuxEnabled = true;
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => tmuxEnabled,
		getSessionName: () => 'main',
		runHostCommand: async (command) => {
			calls.push(command);
			if (calls.length === 1) await firstBlock.promise;
		},
		showFailure: (message) => failures.push(message),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	const first = runner.run({ type: 'focus', target: 'git' });
	const second = runner.run({ type: 'focus', target: 'bash' });
	await Promise.resolve();
	tmuxEnabled = false;
	firstBlock.resolve(undefined);

	assert.deepEqual(await Promise.all([first, second]), [
		{ status: 'handled' },
		{ status: 'handled' },
	]);
	assert.deepEqual(calls, ["mdev tmux app focus 'git' --session 'main'"]);
	assert.deepEqual(failures, [WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE]);
});

void test('Workmux keyboard command runner invalidates pending commands and stale failures', async () => {
	const firstBlock = deferred<void>();
	const calls: string[] = [];
	const failures: string[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => 'main',
		runHostCommand: async (command) => {
			calls.push(command);
			if (calls.length === 1) {
				await firstBlock.promise;
				throw new Error('mdev: command not found');
			}
		},
		showFailure: (message) => failures.push(message),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	const first = runner.run({ type: 'nav', action: 'prev' });
	const second = runner.run({ type: 'focus', target: 'bash' });
	await Promise.resolve();
	runner.invalidate();
	firstBlock.resolve(undefined);

	assert.deepEqual(await Promise.all([first, second]), [
		{ status: 'superseded' },
		{ status: 'superseded' },
	]);
	assert.deepEqual(calls, ["mdev tmux app nav 'prev' --session 'main'"]);
	assert.deepEqual(failures, []);
});

void test('Workmux keyboard command runner preserves local failures and maps remote failures', async () => {
	const failures: string[] = [];
	let tmuxEnabled = false;
	let error: Error | null = null;
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => tmuxEnabled,
		getSessionName: () => '',
		runHostCommand: async () => {
			if (error) throw error;
		},
		showFailure: (message) => failures.push(message),
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	await runner.run({ type: 'focus', target: 'git' });
	tmuxEnabled = true;
	error = new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
	await runner.run({ type: 'nav', action: 'prev-all' });
	error = new Error('mdev: command not found');
	await runner.run({ type: 'nav', action: 'next-all' });

	assert.deepEqual(failures, [
		WORKMUX_KEYBOARD_COMMAND_DISABLED_MESSAGE,
		HOST_BROWSER_NO_CONNECTION_MESSAGE,
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	]);
});
