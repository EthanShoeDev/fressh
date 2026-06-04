import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	WORKMUX_APP_SCROLL_MAX_COUNT,
	WORKMUX_REMOTE_COMMAND_ENV_PREFIX,
	buildWorkmuxAppContextArgv,
	buildWorkmuxAppContextCommand,
	buildWorkmuxAppFocusArgv,
	buildWorkmuxAppFocusCommand,
	buildWorkmuxAppNavArgv,
	buildWorkmuxAppNavCommand,
	buildWorkmuxAppNotificationOpenArgv,
	buildWorkmuxAppNotificationOpenCommand,
	buildWorkmuxAppScrollEnterCommand,
	buildWorkmuxAppScrollExitCommand,
	buildWorkmuxAppScrollPageCommand,
	buildWorkmuxAppWindowArgv,
	buildWorkmuxAppWindowCommand,
	formatWorkmuxAppCommandFailureMessage,
	isWorkmuxAppCommand,
	parseWorkmuxAppContextOutput,
	parseWorkmuxAppWindowOutput,
	prepareWorkmuxAppCommandForRemoteShell,
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

function serializeExpectedMdevCommand(argv: string[]): string {
	return ['mdev', ...argv]
		.map((value, index, tokens) =>
			isExpectedCommandToken(index, tokens)
				? value
				: quoteExpectedShellValue(value),
		)
		.join(' ');
}

function isExpectedCommandToken(
	index: number,
	tokens: string[],
): boolean {
	if (index < 4) return true;
	switch (tokens[3]) {
		case 'context':
		case 'window':
			return index === 4;
		case 'notification':
			return index === 4 || index === 5 || index === 7;
		case 'focus':
			return index === 5;
		case 'nav':
			return tokens[4] === 'select' ? index === 6 : index === 5;
		default:
			return false;
	}
}

function quoteExpectedShellValue(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

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
});

void test('workmux app command builders quote values that look like flags', () => {
	const contextCommand = buildWorkmuxAppContextCommand(
		'--x; echo injected',
	);
	assert.equal(
		contextCommand,
		"mdev tmux app context --session '--x; echo injected'",
	);
	assert.equal(contextCommand.includes('--session --x; echo injected'), false);

	const notificationCommand = buildWorkmuxAppNotificationOpenCommand(
		'main',
		'--window; echo injected',
	);
	assert.equal(
		notificationCommand,
		"mdev tmux app notification open --session 'main' --window-id '--window; echo injected'",
	);
	assert.equal(
		notificationCommand.includes('--window-id --window; echo injected'),
		false,
	);
});

void test('Workmux app argv builders preserve existing command shapes', () => {
	assert.deepEqual(buildWorkmuxAppContextArgv('main'), [
		'tmux',
		'app',
		'context',
		'--session',
		'main',
	]);
	assert.deepEqual(buildWorkmuxAppWindowArgv("main'quoted"), [
		'tmux',
		'app',
		'window',
		'--session',
		"main'quoted",
	]);
	assert.deepEqual(buildWorkmuxAppNotificationOpenArgv('main', '@12'), [
		'tmux',
		'app',
		'notification',
		'open',
		'--session',
		'main',
		'--window-id',
		'@12',
	]);
	assert.deepEqual(buildWorkmuxAppFocusArgv('main', 'codex'), [
		'tmux',
		'app',
		'focus',
		'codex',
		'--session',
		'main',
	]);
	assert.deepEqual(buildWorkmuxAppNavArgv('main', 'next-all'), [
		'tmux',
		'app',
		'nav',
		'next-all',
		'--session',
		'main',
	]);
	assert.deepEqual(buildWorkmuxAppNavArgv('main', 'select', 7), [
		'tmux',
		'app',
		'nav',
		'select',
		'7',
		'--session',
		'main',
	]);
});

void test('Workmux app command builders are derived from argv builders', () => {
	assert.equal(
		buildWorkmuxAppContextCommand("main'quoted"),
		serializeExpectedMdevCommand(buildWorkmuxAppContextArgv("main'quoted")),
	);
	assert.equal(
		buildWorkmuxAppWindowCommand("main'quoted"),
		serializeExpectedMdevCommand(buildWorkmuxAppWindowArgv("main'quoted")),
	);
	assert.equal(
		buildWorkmuxAppNotificationOpenCommand("main'quoted", "@12'bad"),
		serializeExpectedMdevCommand(
			buildWorkmuxAppNotificationOpenArgv("main'quoted", "@12'bad"),
		),
	);
	assert.equal(
		buildWorkmuxAppFocusCommand("main'quoted", 'git'),
		serializeExpectedMdevCommand(
			buildWorkmuxAppFocusArgv("main'quoted", 'git'),
		),
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'select', 3),
		serializeExpectedMdevCommand(buildWorkmuxAppNavArgv('main', 'select', 3)),
	);
});

void test('workmux app command predicate recognizes app-boundary commands', () => {
	assert.equal(
		isWorkmuxAppCommand('mdev tmux app context --session main'),
		true,
	);
	assert.equal(
		isWorkmuxAppCommand(
			`${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} mdev tmux app context --session main`,
		),
		true,
	);
	assert.equal(isWorkmuxAppCommand('mdev   tmux\tapp\ncontext'), true);
	assert.equal(isWorkmuxAppCommand('mdev tmux attach main'), false);
	assert.equal(isWorkmuxAppCommand('tmux app context'), false);
	assert.equal(isWorkmuxAppCommand('mdev tmux application context'), false);
});

void test('workmux app remote shell command preparation adds non-login PATH once', () => {
	assert.equal(
		prepareWorkmuxAppCommandForRemoteShell(
			"mdev tmux app context --session 'main'",
		),
		`${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} mdev tmux app context --session 'main'`,
	);
	assert.equal(
		prepareWorkmuxAppCommandForRemoteShell(
			`${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} mdev tmux app context --session 'main'`,
		),
		`${WORKMUX_REMOTE_COMMAND_ENV_PREFIX} mdev tmux app context --session 'main'`,
	);
	assert.equal(
		prepareWorkmuxAppCommandForRemoteShell('git status'),
		'git status',
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

void test('workmux app parsers do not require window metadata', () => {
	const {
		homeWindow: _contextHomeWindow,
		roleWindow: _contextRoleWindow,
		windowIndex: _contextWindowIndex,
		...minimalContext
	} = context;
	const {
		homeWindow: _windowHomeWindow,
		roleWindow: _windowRoleWindow,
		windowIndex: _windowIndex,
		...minimalWindow
	} = windowProjection;

	assert.deepEqual(
		parseWorkmuxAppContextOutput(JSON.stringify(minimalContext)),
		minimalContext,
	);
	assert.deepEqual(
		parseWorkmuxAppWindowOutput(JSON.stringify(minimalWindow)),
		minimalWindow,
	);
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
		formatWorkmuxAppCommandFailureMessage(
			"env: 'mdev': No such file or directory",
		),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage(
			'env: ‘mdev’: No such file or directory',
		),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown tmux app action: context'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage(
			'Unknown tmux app scroll action: exit',
		),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage(
			'Unknown tmux app notification action: open',
		),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown tmux command: app'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown command: tmux'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage(
			"error: unrecognized subcommand 'tmux'",
		),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage(
			'error: unrecognized subcommand "app"',
		),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('unknown tmux app'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('unknown tmux command app'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('permission denied'),
		'permission denied',
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('  tmux session not found  '),
		'tmux session not found',
	);
});
