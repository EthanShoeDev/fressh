import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	WORKMUX_APP_SCROLL_MAX_COUNT,
	buildWorkmuxAppContextCommand,
	buildWorkmuxAppFocusCommand,
	buildWorkmuxAppNavCommand,
	buildWorkmuxAppNotificationOpenCommand,
	buildWorkmuxAppStatusCycleCommand,
	buildWorkmuxAppScrollEnterCommand,
	buildWorkmuxAppScrollExitCommand,
	buildWorkmuxAppScrollPageCommand,
	buildWorkmuxAppWindowCommand,
	formatWorkmuxAppCommandFailureMessage,
	parseWorkmuxAppContextOutput,
	parseWorkmuxAppWindowOutput,
	type WorkmuxAppContext,
	type WorkmuxAppWindow,
} from '../../src/lib/workmux-app-commands';

const context: WorkmuxAppContext = {
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 12,
	windowName: 'mobile',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
	paneId: '%34',
	paneTty: '/dev/pts/12',
	panePath: "/home/muly/fressh/apps/mobile's",
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
};

const windowProjection: WorkmuxAppWindow = {
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 12,
	windowName: 'mobile',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
};

void test('workmux app command builders shell-quote app arguments', () => {
	assert.equal(
		buildWorkmuxAppContextCommand("main'quoted"),
		"mdev tmux app context --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppWindowCommand("main'quoted"),
		"mdev tmux app window --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppNotificationOpenCommand("main'quoted", "@12'bad"),
		"mdev tmux app notification open --session 'main'\\''quoted' --window-id '@12'\\''bad'",
	);
	assert.equal(
		buildWorkmuxAppScrollEnterCommand("main'quoted"),
		"mdev tmux app scroll enter --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppScrollExitCommand("main'quoted"),
		"mdev tmux app scroll exit --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppScrollPageCommand("main'quoted", 'up', 3),
		"mdev tmux app scroll page-up --count '3' --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppScrollPageCommand('main', 'down', 2),
		"mdev tmux app scroll page-down --count '2' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppFocusCommand('main', 'toggle-git-bash'),
		"mdev tmux app focus 'toggle-git-bash' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'select', 7),
		"mdev tmux app nav 'select' '7' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'select', 0),
		"mdev tmux app nav 'select' '0' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'next'),
		"mdev tmux app nav 'next' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'prev-all'),
		"mdev tmux app nav 'prev-all' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppStatusCycleCommand("main'quoted"),
		"mdev tmux app nav 'next-all' --session 'main'\\''quoted'",
	);
});

void test('workmux app builders normalize blank sessions to main', () => {
	assert.equal(
		buildWorkmuxAppContextCommand('   '),
		"mdev tmux app context --session 'main'",
	);
});

void test('workmux scroll page builder rejects invalid counts', () => {
	for (const count of [0, -1, 21, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() => buildWorkmuxAppScrollPageCommand('main', 'up', count),
			/Invalid Workmux scroll count/,
		);
	}
});

void test('workmux scroll page max count is exported by the command boundary', () => {
	assert.equal(WORKMUX_APP_SCROLL_MAX_COUNT, 20);
	assert.equal(
		buildWorkmuxAppScrollPageCommand(
			'main',
			'up',
			WORKMUX_APP_SCROLL_MAX_COUNT,
		),
		"mdev tmux app scroll page-up --count '20' --session 'main'",
	);
	assert.throws(
		() =>
			buildWorkmuxAppScrollPageCommand(
				'main',
				'up',
				WORKMUX_APP_SCROLL_MAX_COUNT + 1,
			),
		/Invalid Workmux scroll count/,
	);
});

void test('workmux scroll page builder rejects invalid directions', () => {
	assert.throws(
		() =>
			buildWorkmuxAppScrollPageCommand(
				'main',
				'left' as Parameters<typeof buildWorkmuxAppScrollPageCommand>[1],
				1,
			),
		/Invalid Workmux scroll direction/,
	);
});

void test('workmux nav select builder requires an index', () => {
	assert.throws(
		() => buildWorkmuxAppNavCommand('main', 'select'),
		/Missing Workmux nav select index/,
	);
});

void test('workmux nav select builder rejects invalid indexes', () => {
	for (const index of [-1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(
			() => buildWorkmuxAppNavCommand('main', 'select', index),
			/Invalid Workmux nav select index/,
		);
	}
});

void test('workmux nav builder rejects indexes for non-select actions', () => {
	assert.throws(
		() => buildWorkmuxAppNavCommand('main', 'next', 3),
		/Unexpected Workmux nav index/,
	);
});

void test('workmux app context parser accepts one complete JSON object', () => {
	assert.deepEqual(
		parseWorkmuxAppContextOutput(`${JSON.stringify(context)}\n`),
		context,
	);
	assert.deepEqual(
		parseWorkmuxAppContextOutput(
			`${JSON.stringify({ ...context, paneTty: '' })}\n`,
		),
		{ ...context, paneTty: '' },
	);
});

void test('workmux app window parser accepts one complete JSON object', () => {
	assert.deepEqual(
		parseWorkmuxAppWindowOutput(`${JSON.stringify(windowProjection)}\n`),
		windowProjection,
	);
});

void test('workmux app parsers reject bad or ambiguous output', () => {
	for (const output of [
		'',
		'not json',
		'null',
		'[]',
		'"context"',
		`${JSON.stringify(context)}\n${JSON.stringify(context)}`,
		JSON.stringify({ ...context, paneId: '' }),
		JSON.stringify({ ...context, paneTty: undefined }),
		JSON.stringify({ ...context, paneTty: 12 }),
		JSON.stringify({ ...context, roleWindow: 'true' }),
		JSON.stringify({ ...context, windowIndex: '12' }),
		JSON.stringify({ ...context, windowIndex: -1 }),
		JSON.stringify({ ...context, windowIndex: 1.5 }),
		JSON.stringify({ ...context, windowIndex: Number.MAX_SAFE_INTEGER + 1 }),
	]) {
		assert.throws(
			() => parseWorkmuxAppContextOutput(output),
			/Invalid Workmux app context/,
		);
	}

	assert.throws(
		() =>
			parseWorkmuxAppWindowOutput(
				JSON.stringify({ ...windowProjection, windowId: '' }),
			),
		/Invalid Workmux app window/,
	);

	assert.throws(
		() =>
			parseWorkmuxAppWindowOutput(
				JSON.stringify({ ...windowProjection, windowName: '   ' }),
			),
		/Invalid Workmux app window/,
	);

	assert.throws(
		() =>
			parseWorkmuxAppWindowOutput(
				JSON.stringify({ ...windowProjection, homeWindow: 0 }),
			),
		/Invalid Workmux app window/,
	);

	for (const output of [
		'null',
		'[]',
		'"window"',
		JSON.stringify({ ...windowProjection, windowIndex: -1 }),
		JSON.stringify({ ...windowProjection, windowIndex: 1.5 }),
		JSON.stringify({
			...windowProjection,
			windowIndex: Number.MAX_SAFE_INTEGER + 1,
		}),
	]) {
		assert.throws(
			() => parseWorkmuxAppWindowOutput(output),
			/Invalid Workmux app window/,
		);
	}
});

void test('workmux app parsers default missing optional strings', () => {
	const {
		role: _contextRole,
		workspaceId: _contextWorkspaceId,
		...baseContext
	} = context;
	const {
		role: _windowRole,
		workspaceId: _windowWorkspaceId,
		...baseWindow
	} = windowProjection;

	assert.deepEqual(parseWorkmuxAppContextOutput(JSON.stringify(baseContext)), {
		...baseContext,
		workspaceId: '',
		role: '',
	});
	assert.deepEqual(parseWorkmuxAppWindowOutput(JSON.stringify(baseWindow)), {
		...baseWindow,
		workspaceId: '',
		role: '',
	});
});

void test('workmux app parsers reject non-string optional fields', () => {
	for (const output of [
		JSON.stringify({ ...context, workspaceId: 1 }),
		JSON.stringify({ ...context, role: false }),
	]) {
		assert.throws(
			() => parseWorkmuxAppContextOutput(output),
			/Invalid Workmux app context/,
		);
	}

	for (const output of [
		JSON.stringify({ ...windowProjection, workspaceId: 1 }),
		JSON.stringify({ ...windowProjection, role: false }),
	]) {
		assert.throws(
			() => parseWorkmuxAppWindowOutput(output),
			/Invalid Workmux app window/,
		);
	}
});

void test('workmux app update message is explicit', () => {
	assert.equal(
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('   '),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('mdev: command not found'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('tmux: command not found'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('zsh: command not found: mdev'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('zsh: command not found: tmux'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('sh: 1: mdev: not found'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('sh: 1: tmux: not found'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown tmux app action: context'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown tmux command: app'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('permission denied'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
});
