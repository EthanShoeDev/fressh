import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDirectTmuxSelectWindowCommand,
	buildDirectTmuxScrollEnterCommand,
	buildDirectTmuxScrollExitCommand,
	buildDirectTmuxScrollMoveCommand,
	createDirectTmuxControlTransport,
} from '../../src/lib/workmux-direct-tmux-control';

function fakeShell() {
	const writes: string[] = [];
	return {
		writes,
		shell: {
			channelId: 7,
			addListener: () => 1n,
			removeListener: () => {},
			sendData: async (bytes: ArrayBuffer) => {
				writes.push(new TextDecoder().decode(bytes));
			},
			close: async () => {
				writes.push('__closed__');
			},
		},
	};
}

void test('DirectMux command builders escape targets and counts', () => {
	assert.equal(
		buildDirectTmuxScrollEnterCommand("main'bad"),
		"tmux copy-mode -t 'main'\\''bad'",
	);
	assert.equal(
		buildDirectTmuxScrollMoveCommand({
			sessionName: 'main',
			direction: 'down',
			unit: 'line',
			count: 3,
		}),
		'tmux send-keys -t main -N 3 -X scroll-down',
	);
	assert.equal(
		buildDirectTmuxScrollMoveCommand({
			sessionName: 'main',
			direction: 'up',
			unit: 'page',
			count: 2,
		}),
		'tmux send-keys -t main -N 2 -X page-up',
	);
	assert.equal(
		buildDirectTmuxScrollExitCommand('main'),
		'tmux send-keys -t main q',
	);
	assert.equal(
		buildDirectTmuxSelectWindowCommand('main', '@12'),
		"tmux select-window -t 'main:@12'",
	);
});

void test('DirectMux transport reuses one hidden shell and closes it', async () => {
	const created = fakeShell();
	let startCount = 0;
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => {
				startCount += 1;
				return created.shell;
			},
		},
	});

	await transport.send('tmux display-message first');
	await transport.send('tmux display-message second');
	await transport.dispose();

	assert.equal(startCount, 1);
	assert.deepEqual(created.writes, [
		'tmux display-message first\n',
		'tmux display-message second\n',
		'__closed__',
	]);
});
