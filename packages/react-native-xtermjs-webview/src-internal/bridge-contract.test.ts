import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	handleTmuxScrollBatchBridgeMessage,
	mapTmuxScrollBatchMessage,
} from '../src/bridge';
import { handleXtermBridgeInboundMessage } from '../src/xterm-message-handler';

void test('tmux scroll batch mapper strips only bridge message type', () => {
	assert.deepEqual(
		mapTmuxScrollBatchMessage({
			type: 'tmuxScrollBatch',
			direction: 'up',
			pages: 2,
			lines: 3,
			pageStep: 24,
			instanceId: 'instance-1',
			seq: 7,
			ts: 123,
		}),
		{
			direction: 'up',
			pages: 2,
			lines: 3,
			pageStep: 24,
			instanceId: 'instance-1',
			seq: 7,
			ts: 123,
		},
	);
});

void test('tmuxScrollBatch bridge helper forwards pageStep', () => {
	const events: unknown[] = [];

	assert.equal(
		handleTmuxScrollBatchBridgeMessage(
			{
				type: 'tmuxScrollBatch',
				direction: 'down',
				pages: 1,
				lines: 5,
				pageStep: 32,
				instanceId: 'instance-2',
				seq: 9,
				ts: 456,
			},
			(event) => events.push(event),
		),
		true,
	);

	assert.deepEqual(events, [
		{
			direction: 'down',
			pages: 1,
			lines: 5,
			pageStep: 32,
			instanceId: 'instance-2',
			seq: 9,
			ts: 456,
		},
	]);
});

void test('XtermJsWebView message handler routes current instance events and drops stale ones', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const pendingSelectionRef = { current: new Map() };
	const handle = (msg: Parameters<typeof handleXtermBridgeInboundMessage>[0]) =>
		handleXtermBridgeInboundMessage(msg, {
			currentInstanceIdRef,
			pendingSelectionRef,
			onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
			autoFitFn: () => events.push('fit'),
			setInitialized: (initialized) => events.push(`state:${initialized}`),
			onInput: (input) => events.push(['input', input]),
			onData: (data) => events.push(`data:${data}`),
			onResize: (cols, rows) => events.push(`resize:${cols}x${rows}`),
			onSelection: (text) => events.push(`selection:${text}`),
			onSelectionModeChange: (enabled) =>
				events.push(`selection-mode:${enabled}`),
			onScrollbackModeChange: (event) => events.push(['scrollback-mode', event]),
			onScrollbackEnterRequested: (event) =>
				events.push(['scrollback-enter', event]),
			onTmuxScrollBatch: (event) => events.push(['scroll-batch', event]),
		});

	assert.equal(handle({ type: 'initialized', instanceId: 'instance-1' }), true);
	assert.equal(
		handle({
			type: 'scrollbackEnterRequested',
			instanceId: 'instance-1',
			requestId: 7,
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'tmuxScrollBatch',
			direction: 'down',
			pages: 1,
			lines: 5,
			pageStep: 32,
			instanceId: 'instance-1',
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'scrollbackEnterRequested',
			instanceId: 'stale-instance',
			requestId: 8,
		}),
		true,
	);
	assert.equal(handle({ type: 'debug', message: 'hello' }), true);

	assert.deepEqual(events, [
		'initialized:instance-1',
		'fit',
		'state:true',
		[
			'scrollback-enter',
			{
				instanceId: 'instance-1',
				requestId: 7,
			},
		],
		[
			'scroll-batch',
			{
				direction: 'down',
				pages: 1,
				lines: 5,
				pageStep: 32,
				instanceId: 'instance-1',
			},
		],
	]);

	const source = readFileSync(join(process.cwd(), 'src/index.tsx'), 'utf8');
	assert.match(source, /handleXtermBridgeInboundMessage\(msg, \{/);
});

void test('public dist artifacts keep the published touch scroll bridge contract', () => {
	const packageRoot = process.cwd();
	const artifacts = [
		'dist/index.js',
		'dist/index.d.ts',
		'dist/bridge.d.ts',
		'dist-internal/index.html',
	].map((path) => ({
			path,
			content: readFileSync(join(packageRoot, path), 'utf8'),
		}));
	const removedContracts = [
		/emitExit/,
		/enterDelayMs/,
		/prefixKey/,
		/copyModeKey/,
		/cancelKey/,
		/exitKey/,
		/['"]typing['"]\s*\|\s*['"]scroll['"]/,
		/tmuxEnterCopyMode/,
		/tmuxEnterCopyModeAck/,
	];

	for (const { path, content } of artifacts) {
		if (path === 'dist/index.d.ts') {
			assert.match(content, /onTmuxScrollBatch\?: \(event: TmuxScrollBatchEvent\)/);
			assert.match(
				content,
				/onScrollbackEnterRequested\?: \(event: \{\s+instanceId: string;\s+requestId: number;\s+\}\) => void;/,
			);
			assert.match(
				content,
				/sendScrollbackEnterAck: \(requestId: number, instanceId: string\) => void;/,
			);
			assert.match(
				content,
				/export type \{ TmuxScrollBatchEvent, TouchScrollConfig \}/,
			);
		} else if (path === 'dist/bridge.d.ts') {
			assert.match(content, /scrollbackEnterRequested/);
			assert.match(content, /scrollbackEnterAck/);
		} else {
			assert.match(content, /pageStep/);
			assert.match(content, /scrollbackEnterRequested/);
			assert.match(content, /scrollbackEnterAck/);
		}
		for (const removedContract of removedContracts) {
			assert.doesNotMatch(content, removedContract);
		}
	}
});
