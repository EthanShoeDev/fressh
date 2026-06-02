import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	buildWorkmuxAppContextCommand,
	buildWorkmuxAppFocusCommand,
	buildWorkmuxAppNavCommand,
	buildWorkmuxAppNotificationOpenCommand,
	buildWorkmuxAppScrollEnterCommand,
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
});

void test('workmux app builders normalize blank sessions to main', () => {
	assert.equal(
		buildWorkmuxAppContextCommand('   '),
		"mdev tmux app context --session 'main'",
	);
});

void test('workmux scroll page builder rejects invalid counts', () => {
	for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() => buildWorkmuxAppScrollPageCommand('main', 'up', count),
			/Invalid Workmux scroll count/,
		);
	}
});

void test('workmux nav select builder requires an index', () => {
	assert.throws(
		() => buildWorkmuxAppNavCommand('main', 'select'),
		/Missing Workmux nav select index/,
	);
});

void test('workmux app context parser accepts one complete JSON object', () => {
	assert.deepEqual(
		parseWorkmuxAppContextOutput(`${JSON.stringify(context)}\n`),
		context,
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
		`${JSON.stringify(context)}\n${JSON.stringify(context)}`,
		JSON.stringify({ ...context, paneId: '' }),
		JSON.stringify({ ...context, windowIndex: '12' }),
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
});

void test('workmux app update message is explicit', () => {
	assert.equal(
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('mdev: command not found'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown tmux app action: context'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('permission denied'),
		'permission denied',
	);
});
