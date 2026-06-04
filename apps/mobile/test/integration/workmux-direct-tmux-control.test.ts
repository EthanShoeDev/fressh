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

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
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
		'tmux send-keys -t main -X cancel',
	);
	assert.equal(
		buildDirectTmuxSelectWindowCommand('main', '@12'),
		"tmux select-window -t 'main:@12'",
	);
});

void test('DirectMux scroll move rejects invalid direction and unit', () => {
	assert.throws(
		() =>
			buildDirectTmuxScrollMoveCommand({
				sessionName: 'main',
				direction: 'left' as never,
				unit: 'line',
				count: 1,
			}),
		/Invalid DirectMux direction: left/,
	);
	assert.throws(
		() =>
			buildDirectTmuxScrollMoveCommand({
				sessionName: 'main',
				direction: 'up',
				unit: 'chunk' as never,
				count: 1,
			}),
		/Invalid DirectMux unit: chunk/,
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

void test('DirectMux transport closes failed shell and retries with replacement', async () => {
	const first = fakeShell();
	const second = fakeShell();
	let startCount = 0;
	first.shell.sendData = async () => {
		throw new Error('write failed');
	};
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => {
				startCount += 1;
				return startCount === 1 ? first.shell : second.shell;
			},
		},
	});

	assert.equal(await transport.send('tmux display-message first'), false);
	assert.equal(await transport.send('tmux display-message second'), true);
	await transport.dispose();

	assert.equal(startCount, 2);
	assert.deepEqual(first.writes, ['__closed__']);
	assert.deepEqual(second.writes, [
		'tmux display-message second\n',
		'__closed__',
	]);
});

void test('DirectMux transport rejects embedded line breaks without writing', async () => {
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

	assert.equal(await transport.send('tmux display-message bad\nnext'), false);
	assert.equal(await transport.send('tmux display-message bad\rnext'), false);
	await transport.dispose();

	assert.equal(startCount, 0);
	assert.deepEqual(created.writes, []);
});

void test('DirectMux transport returns false after dispose', async () => {
	const created = fakeShell();
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => created.shell,
		},
	});

	await transport.dispose();

	assert.equal(await transport.send('tmux display-message after'), false);
	assert.deepEqual(created.writes, []);
});

void test('DirectMux transport serializes sends and dispose waits for queue', async () => {
	const created = fakeShell();
	const firstStarted = deferred();
	const releaseFirst = deferred();
	let activeWrites = 0;
	let maxActiveWrites = 0;
	let isFirstWrite = true;
	created.shell.sendData = async (bytes: ArrayBuffer) => {
		const command = new TextDecoder().decode(bytes);
		activeWrites += 1;
		maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
		created.writes.push(`start:${command}`);
		if (isFirstWrite) {
			isFirstWrite = false;
			firstStarted.resolve();
			await releaseFirst.promise;
		}
		created.writes.push(`finish:${command}`);
		activeWrites -= 1;
	};
	const transport = createDirectTmuxControlTransport({
		connection: {
			startShell: async () => created.shell,
		},
	});

	const firstSend = transport.send('tmux display-message first');
	await firstStarted.promise;
	const secondSend = transport.send('tmux display-message second');
	const dispose = transport.dispose();
	releaseFirst.resolve();

	assert.equal(await firstSend, true);
	assert.equal(await secondSend, true);
	await dispose;

	assert.equal(maxActiveWrites, 1);
	assert.deepEqual(created.writes, [
		'start:tmux display-message first\n',
		'finish:tmux display-message first\n',
		'start:tmux display-message second\n',
		'finish:tmux display-message second\n',
		'__closed__',
	]);
});
