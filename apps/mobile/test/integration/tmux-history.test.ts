import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildTmuxHistoryCopyModeCommand,
	isTmuxHistoryBrowseActive,
	TMUX_HISTORY_LIVE_LABEL,
	buildTmuxHistoryControlCommand,
	buildTmuxHistoryEnterCommand,
	getTmuxHistoryControlFailurePolicy,
	getTmuxHistoryLiveInputPolicy,
	getTmuxHistoryToggleAction,
	getTmuxHistoryFallbackSequence,
	isTmuxHistoryModeConfirmed,
	runTmuxControlCommand,
	shouldApplyTmuxHistoryEntryResult,
} from '../../src/lib/tmux-history';

void test('buildTmuxHistoryControlCommand maps browse commands to tmux copy-mode verbs', () => {
	assert.equal(
		buildTmuxHistoryControlCommand('UP', 'main'),
		"tmux send-keys -t 'main' -X scroll-up",
	);
	assert.equal(
		buildTmuxHistoryControlCommand('DOWN', 'main'),
		"tmux send-keys -t 'main' -X scroll-down",
	);
	assert.equal(
		buildTmuxHistoryControlCommand('PAGE_UP', 'main'),
		"tmux send-keys -t 'main' -X page-up",
	);
	assert.equal(
		buildTmuxHistoryControlCommand('PAGE_DOWN', 'main'),
		"tmux send-keys -t 'main' -X page-down",
	);
	assert.equal(
		buildTmuxHistoryControlCommand('TOP', "main's"),
		"tmux send-keys -t 'main'\\''s' -X history-top",
	);
});

void test('buildTmuxHistoryCopyModeCommand enters copy mode through tmux control shell', () => {
	assert.equal(
		buildTmuxHistoryCopyModeCommand("main's"),
		"tmux copy-mode -t 'main'\\''s'",
	);
});

void test('runTmuxControlCommand waits for async send success and failure', async () => {
	const writes: string[] = [];
	const ok = await runTmuxControlCommand(
		{
			send: async (bytes) => {
				writes.push(new TextDecoder().decode(bytes));
			},
		},
		'tmux list-panes',
	);
	assert.equal(ok, true);
	assert.deepEqual(writes, ['tmux list-panes\n']);

	const failed = await runTmuxControlCommand(
		{
			send: async () => {
				throw new Error('channel closed');
			},
		},
		'tmux list-panes',
	);
	assert.equal(failed, false);
	assert.equal(await runTmuxControlCommand(null, 'tmux list-panes'), false);
});

void test('getTmuxHistoryFallbackSequence omits top and exit-only commands', () => {
	assert.equal(getTmuxHistoryFallbackSequence('UP'), null);
	assert.equal(getTmuxHistoryFallbackSequence('DOWN'), null);
	assert.equal(getTmuxHistoryFallbackSequence('PAGE_UP'), null);
	assert.equal(getTmuxHistoryFallbackSequence('PAGE_DOWN'), null);
	assert.equal(getTmuxHistoryFallbackSequence('TOP'), null);
	assert.equal(getTmuxHistoryFallbackSequence('LIVE'), null);
	assert.equal(getTmuxHistoryFallbackSequence('CLOSE'), null);
});

void test('getTmuxHistoryToggleAction distinguishes enter, adopt, exit, and noop cases', () => {
	assert.equal(
		getTmuxHistoryToggleAction({
			tmuxEnabled: false,
			tmuxControlReady: false,
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'noop-disabled',
	);
	assert.equal(
		getTmuxHistoryToggleAction({
			tmuxEnabled: true,
			tmuxControlReady: false,
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'noop-disabled',
	);
	assert.equal(
		getTmuxHistoryToggleAction({
			tmuxEnabled: true,
			tmuxControlReady: true,
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'enter',
	);
	assert.equal(
		getTmuxHistoryToggleAction({
			tmuxEnabled: true,
			tmuxControlReady: true,
			historyModeActive: false,
			scrollbackActive: true,
			pendingEnter: false,
		}),
		'adopt',
	);
	assert.equal(
		getTmuxHistoryToggleAction({
			tmuxEnabled: true,
			tmuxControlReady: false,
			historyModeActive: true,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'exit',
	);
	assert.equal(
		getTmuxHistoryToggleAction({
			tmuxEnabled: true,
			tmuxControlReady: true,
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: true,
		}),
		'noop-pending',
	);
});

void test('buildTmuxHistoryEnterCommand verifies pane_in_mode before history mode becomes active', () => {
	assert.equal(
		buildTmuxHistoryEnterCommand("main's"),
		"tmux copy-mode -t 'main'\\''s'; tmux display-message -p -t 'main'\\''s' '#{pane_in_mode}'",
	);
});

void test('isTmuxHistoryModeConfirmed requires a trailing pane_in_mode value of 1', () => {
	assert.equal(isTmuxHistoryModeConfirmed('1'), true);
	assert.equal(isTmuxHistoryModeConfirmed('\n1\r\n'), true);
	assert.equal(isTmuxHistoryModeConfirmed('0'), false);
	assert.equal(isTmuxHistoryModeConfirmed('copy-mode\n1'), true);
	assert.equal(isTmuxHistoryModeConfirmed('copy-mode\n0'), false);
});

void test('tmux history live button keeps the approved Bottom/Live label', () => {
	assert.equal(TMUX_HISTORY_LIVE_LABEL, 'Bottom/Live');
});

void test('shouldApplyTmuxHistoryEntryResult rejects stale async confirmations', () => {
	assert.equal(
		shouldApplyTmuxHistoryEntryResult({
			requestId: 3,
			activeRequestId: 3,
			requestedInstanceId: 'inst-a',
			currentInstanceId: 'inst-a',
		}),
		true,
	);
	assert.equal(
		shouldApplyTmuxHistoryEntryResult({
			requestId: 3,
			activeRequestId: 4,
			requestedInstanceId: 'inst-a',
			currentInstanceId: 'inst-a',
		}),
		false,
	);
	assert.equal(
		shouldApplyTmuxHistoryEntryResult({
			requestId: 3,
			activeRequestId: 3,
			requestedInstanceId: 'inst-a',
			currentInstanceId: 'inst-b',
		}),
		false,
	);
});

void test('isTmuxHistoryBrowseActive treats pending entry as browse-active', () => {
	assert.equal(
		isTmuxHistoryBrowseActive({
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		false,
	);
	assert.equal(
		isTmuxHistoryBrowseActive({
			historyModeActive: true,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		true,
	);
	assert.equal(
		isTmuxHistoryBrowseActive({
			historyModeActive: false,
			scrollbackActive: true,
			pendingEnter: false,
		}),
		true,
	);
	assert.equal(
		isTmuxHistoryBrowseActive({
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: true,
		}),
		true,
	);
});

void test('getTmuxHistoryLiveInputPolicy blocks pending entry and only auto-exits confirmed browse', () => {
	assert.equal(
		getTmuxHistoryLiveInputPolicy({
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'pass-through',
	);
	assert.equal(
		getTmuxHistoryLiveInputPolicy({
			historyModeActive: true,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'exit-before-send',
	);
	assert.equal(
		getTmuxHistoryLiveInputPolicy({
			historyModeActive: false,
			scrollbackActive: true,
			pendingEnter: false,
		}),
		'exit-before-send',
	);
	assert.equal(
		getTmuxHistoryLiveInputPolicy({
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: true,
		}),
		'block-pending-entry',
	);
});

void test('getTmuxHistoryControlFailurePolicy only sends live cancel for confirmed browse mode', () => {
	assert.equal(
		getTmuxHistoryControlFailurePolicy({
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'restart-control-only',
	);
	assert.equal(
		getTmuxHistoryControlFailurePolicy({
			historyModeActive: false,
			scrollbackActive: false,
			pendingEnter: true,
		}),
		'restart-control-only',
	);
	assert.equal(
		getTmuxHistoryControlFailurePolicy({
			historyModeActive: true,
			scrollbackActive: false,
			pendingEnter: false,
		}),
		'exit-browse-and-restart-control',
	);
	assert.equal(
		getTmuxHistoryControlFailurePolicy({
			historyModeActive: false,
			scrollbackActive: true,
			pendingEnter: false,
		}),
		'exit-browse-and-restart-control',
	);
});
