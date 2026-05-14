import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDiffityShareCommand,
	buildHostBrowserPanePathCommand,
	buildHostBrowserStatusCycleCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	isHostBrowserUrlSlot,
	parseHostBrowserUrlInput,
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
		"cd '/home/muly/work folder/repo'\\''s' && diffity-share",
	);
	assert.equal(
		buildTmuxWindowConfigGetCommand('window-url', '/tmp/work repo'),
		"TMUX_PANE_PATH='/tmp/work repo' tmux-window-config-url get 'window-url'",
	);
	assert.equal(
		buildTmuxWindowConfigSetCommand(
			'dev-web-server-url',
			'/tmp/work repo',
			'https://example.com/app?q=1',
		),
		"TMUX_PANE_PATH='/tmp/work repo' tmux-window-config-url set-value 'dev-web-server-url' 'https://example.com/app?q=1'",
	);
	assert.equal(buildHostBrowserStatusCycleCommand(), 'tmux-nav.sh cycle');
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
