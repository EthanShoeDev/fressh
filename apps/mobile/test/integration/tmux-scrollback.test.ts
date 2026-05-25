import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxScrollbackCopyModeCommand,
	buildTmuxSelectWindowCommand,
	getTmuxScrollbackControlFailurePolicy,
	getTmuxScrollbackLiveInputPolicy,
} from '../../src/lib/tmux-scrollback';

void test('buildTmuxScrollbackCopyModeCommand enters copy mode through tmux control shell', () => {
	assert.equal(
		buildTmuxScrollbackCopyModeCommand("main's"),
		"tmux copy-mode -t 'main'\\''s'",
	);
});

void test('buildTmuxSelectWindowCommand targets an agent alert tmux window id', () => {
	assert.equal(
		buildTmuxSelectWindowCommand("main's", '@12'),
		"tmux select-window -t 'main'\\''s:@12'",
	);
});

void test('tmux scrollback live input policy only exits active scrollback', () => {
	assert.equal(
		getTmuxScrollbackLiveInputPolicy({ scrollbackActive: false }),
		'pass-through',
	);
	assert.equal(
		getTmuxScrollbackLiveInputPolicy({ scrollbackActive: true }),
		'exit-before-send',
	);
});

void test('tmux scrollback control failure policy only exits active scrollback', () => {
	assert.equal(
		getTmuxScrollbackControlFailurePolicy({ scrollbackActive: false }),
		'restart-control-only',
	);
	assert.equal(
		getTmuxScrollbackControlFailurePolicy({ scrollbackActive: true }),
		'exit-scrollback-and-restart-control',
	);
});
