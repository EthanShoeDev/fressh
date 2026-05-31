import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDiffityShareCommand,
	buildHostBrowserPaneContextCommand,
	buildHostBrowserPanePathCommand,
	buildHostBrowserStatusCycleCommand,
	buildMdevOpenCommand,
	buildTmuxCurrentWindowIdCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	isHostBrowserUrlSlot,
	parseHostBrowserUrlInput,
	parseTmuxPaneContextOutput,
} from '../../src/lib/host-browser-actions';

void test('extractLastHttpsUrl returns the final https URL from helper output', () => {
	const output = [
		'Base: dev (open PR) - reused',
		'',
		'https://host.tailnet.ts.net:8123/diff?ref=dev',
		'trailing log line',
		'https://host.tailnet.ts.net:9000/diff?ref=main',
	].join('\n');

	assert.equal(
		extractLastHttpsUrl(output),
		'https://host.tailnet.ts.net:9000/diff?ref=main',
	);
	assert.equal(extractLastHttpsUrl('no url here'), null);
});

void test('host browser command builders shell-quote dynamic values', () => {
	assert.equal(
		buildHostBrowserPanePathCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{pane_current_path}'",
	);
	assert.equal(
		buildDiffityShareCommand("/home/muly/work folder/repo's"),
		"cd '/home/muly/work folder/repo'\\''s' && mdev diffity share",
	);
	assert.equal(
		buildTmuxWindowConfigGetCommand('window-url', '/tmp/work repo'),
		"TMUX_PANE_PATH='/tmp/work repo' mdev tmux url get 'window-url'",
	);
	assert.equal(
		buildTmuxWindowConfigSetCommand(
			'dev-web-server-url',
			'/tmp/work repo',
			'https://example.com/app?q=1',
		),
		"TMUX_PANE_PATH='/tmp/work repo' mdev tmux url set-value 'dev-web-server-url' 'https://example.com/app?q=1'",
	);
	assert.equal(
		buildHostBrowserStatusCycleCommand("main'quoted"),
		"mdev tmux nav cycle 'main'\\''quoted:'",
	);
});

void test('status cycle command uses mdev tmux nav cycle for main session', () => {
	assert.equal(
		buildHostBrowserStatusCycleCommand('main'),
		"mdev tmux nav cycle 'main:'",
	);
});

void test('current window id command shell-quotes tmux session', () => {
	assert.equal(
		buildTmuxCurrentWindowIdCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{window_id}'",
	);
});

void test('pane context command shell-quotes tmux session', () => {
	assert.equal(
		buildHostBrowserPaneContextCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{pane_id}\t#{pane_tty}\t#{pane_current_path}'",
	);
});

void test('parseTmuxPaneContextOutput returns the last complete pane context line', () => {
	assert.deepEqual(
		parseTmuxPaneContextOutput(
			[
				'noise',
				'%2\t/dev/pts/7\t/home/muly/work repo',
				'',
				'%3\t/dev/pts/8\t/tmp/repo with spaces',
				'trailing noise',
				'log\tfield\tvalue',
			].join('\n'),
		),
		{
			paneId: '%3',
			paneTty: '/dev/pts/8',
			panePath: '/tmp/repo with spaces',
		},
	);
});

void test('parseTmuxPaneContextOutput rejects malformed pane context output', () => {
	assert.equal(parseTmuxPaneContextOutput(''), null);
	assert.equal(parseTmuxPaneContextOutput('%1\t/dev/pts/1'), null);
	assert.equal(parseTmuxPaneContextOutput('\t/dev/pts/1\t/tmp/repo'), null);
	assert.equal(parseTmuxPaneContextOutput('%1\t\t/tmp/repo'), null);
	assert.equal(parseTmuxPaneContextOutput('%1\t/dev/pts/1\t'), null);
});

void test('mdev open command shell-quotes pane context values', () => {
	assert.equal(
		buildMdevOpenCommand('auto', {
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: "/home/muly/work repo's",
		}),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open auto",
	);
	assert.equal(
		buildMdevOpenCommand('pick', {
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: '/home/muly/work repo',
		}),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo' mdev open pick",
	);
});

void test('host browser URL slots have user-facing labels', () => {
	assert.equal(getHostBrowserUrlSlotLabel('window-url'), 'URL');
	assert.equal(getHostBrowserUrlSlotLabel('dev-web-server-url'), 'Web');
	assert.equal(getHostBrowserUrlSlotLabel('storybook-url'), 'Story');
	assert.equal(getHostBrowserUrlSlotLabel('app-url'), 'App');
});

void test('isHostBrowserUrlSlot identifies supported URL slots', () => {
	assert.equal(isHostBrowserUrlSlot('window-url'), true);
	assert.equal(isHostBrowserUrlSlot('dev-web-server-url'), true);
	assert.equal(isHostBrowserUrlSlot('unknown-url'), false);
	assert.equal(isHostBrowserUrlSlot(''), false);
});

void test('parseHostBrowserUrlInput trims and validates http URLs', () => {
	assert.deepEqual(parseHostBrowserUrlInput('   '), { type: 'empty' });
	assert.deepEqual(parseHostBrowserUrlInput('ftp://example.com'), {
		type: 'invalid',
		message: 'Enter an http:// or https:// URL.',
	});
	assert.deepEqual(parseHostBrowserUrlInput('not a url'), {
		type: 'invalid',
		message: 'Enter a valid URL.',
	});
	assert.deepEqual(parseHostBrowserUrlInput(' https://example.com/path '), {
		type: 'valid',
		url: 'https://example.com/path',
	});
	assert.deepEqual(parseHostBrowserUrlInput('https://example.com/foo bar'), {
		type: 'valid',
		url: 'https://example.com/foo%20bar',
	});
});
