import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	handleScrollbackBatchBridgeMessage,
	mapScrollbackBatchMessage,
} from '../src/bridge';
import {
	createScrollbackEnterRequestFailureHandler,
	handleXtermBridgeInboundMessage,
} from '../src/xterm-message-handler';
import { createXtermWebViewMessageHandler } from './webview-message-handler';

void test('scrollback batch mapper strips only bridge message type', () => {
	assert.deepEqual(
		mapScrollbackBatchMessage({
			type: 'scrollbackBatch',
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

void test('scrollbackBatch bridge helper forwards pageStep', () => {
	const events: unknown[] = [];

	assert.equal(
		handleScrollbackBatchBridgeMessage(
			{
				type: 'scrollbackBatch',
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

void test('legacy tmuxScrollBatch bridge helper aliases scrollback batches', () => {
	const events: unknown[] = [];

	assert.equal(
		handleScrollbackBatchBridgeMessage(
			{
				type: 'tmuxScrollBatch',
				direction: 'up',
				pages: 2,
				lines: 4,
				pageStep: 24,
				instanceId: 'instance-legacy',
				seq: 10,
				ts: 789,
			},
			(event) => events.push(event),
		),
		true,
	);

	assert.deepEqual(events, [
		{
			direction: 'up',
			pages: 2,
			lines: 4,
			pageStep: 24,
			instanceId: 'instance-legacy',
			seq: 10,
			ts: 789,
		},
	]);
});

void test('legacy tmuxScrollBatch without pageStep defaults to one line page', () => {
	const events: unknown[] = [];

	assert.equal(
		handleScrollbackBatchBridgeMessage(
			{
				type: 'tmuxScrollBatch',
				direction: 'down',
				pages: 3,
				lines: 0,
				instanceId: 'instance-legacy',
			},
			(event) => events.push(event),
		),
		true,
	);

	assert.deepEqual(events, [
		{
			direction: 'down',
			pages: 3,
			lines: 0,
			pageStep: 1,
			instanceId: 'instance-legacy',
		},
	]);
});

void test('XtermJsWebView message handler routes current instance events and drops stale ones', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const pendingSelectionRef = {
		current: new Map<number, { resolve: (value: string) => void }>(),
	};
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
			onScrollbackEnterRequested: (event) => {
				events.push(['scrollback-enter', event]);
			},
			onScrollbackBatch: (event) => events.push(['scroll-batch', event]),
		});

	assert.equal(handle({ type: 'initialized', instanceId: 'instance-1' }), true);
	pendingSelectionRef.current.set(9, {
		resolve: (value) => events.push(`pending-selection:${value}`),
	});
	assert.equal(
		handle({
			type: 'input',
			str: 'abc',
			instanceId: 'instance-1',
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'sizeChanged',
			cols: 80,
			rows: 24,
			instanceId: 'instance-1',
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'selection',
			requestId: 9,
			text: 'selected',
			instanceId: 'instance-1',
		}),
		true,
	);
	assert.equal(pendingSelectionRef.current.has(9), false);
	assert.equal(
		handle({
			type: 'selectionChanged',
			text: 'visible selection',
			instanceId: 'instance-1',
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'selectionModeChanged',
			enabled: true,
			instanceId: 'instance-1',
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'scrollbackModeChanged',
			active: true,
			phase: 'dragging',
			instanceId: 'instance-1',
			requestId: 6,
		}),
		true,
	);
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
			type: 'tmuxEnterCopyMode',
			instanceId: 'instance-1',
			requestId: 9,
		}),
		true,
	);
	assert.equal(
		handle({
			type: 'scrollbackBatch',
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
			'input',
			{
				str: 'abc',
				kind: 'typing',
				instanceId: 'instance-1',
			},
		],
		'data:abc',
		'resize:80x24',
		'pending-selection:selected',
		'selection:visible selection',
		'selection-mode:true',
		[
			'scrollback-mode',
			{
				active: true,
				phase: 'dragging',
				instanceId: 'instance-1',
				requestId: 6,
			},
		],
		[
			'scrollback-enter',
			{
				instanceId: 'instance-1',
				requestId: 7,
			},
		],
		[
			'scrollback-enter',
			{
				instanceId: 'instance-1',
				requestId: 9,
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
});

void test('XtermJsWebView message handler drops stale size changes', () => {
	const events: unknown[] = [];

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'sizeChanged',
				cols: 120,
				rows: 40,
				instanceId: 'stale-instance',
			},
			{
				currentInstanceIdRef: { current: 'instance-1' },
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => {},
				setInitialized: () => {},
				onResize: (cols, rows) => events.push(`resize:${cols}x${rows}`),
			},
		),
		true,
	);

	assert.deepEqual(events, [
		[
			'warn',
			['dropping stale webview message', 'sizeChanged', 'stale-instance'],
		],
	]);
});

void test('XtermJsWebView message handler does not forward stale scroll input to terminal data', () => {
	const events: unknown[] = [];

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'input',
				str: '\u001b[A',
				kind: 'scroll',
				instanceId: 'instance-1',
			} as never,
			{
				currentInstanceIdRef: { current: 'instance-1' },
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => {},
				setInitialized: () => {},
				onInput: (input) => events.push(['input', input]),
				onData: (data) => events.push(['data', data]),
			},
		),
		true,
	);

	assert.deepEqual(events, [
		['warn', ['dropping non-typing webview input', 'scroll']],
	]);
});

void test('WebView outbound handler ignores stale scrollback instance messages', () => {
	const events: unknown[] = [];
	const handler = createXtermWebViewMessageHandler({
		instanceId: 'current-instance',
		term: {
			cols: 80,
			rows: 24,
			options: {},
			write: () => events.push('write'),
			resize: () => events.push('resize'),
			getSelection: () => 'selected',
			clear: () => events.push('clear'),
			focus: () => events.push('focus'),
		},
		fitAddon: {
			fit: () => events.push('fit'),
		},
		selectionHandles: {
			applySelectionMode: () => events.push('selection-mode'),
		},
		touchScrollController: {
			setConfig: () => events.push('set-config'),
			exitScrollback: (opts) => events.push(['exit', opts]),
			handleEnterAck: (requestId) => events.push(['ack', requestId]),
		},
		sendToRn: (message) => events.push(['rn', message]),
		applyFontFamily: () => events.push('font-family'),
	});

	handler({
		data: {
			type: 'exitScrollback',
			requestId: 1,
			instanceId: 'stale-instance',
		},
	} as MessageEvent);
	handler({
		data: {
			type: 'scrollbackEnterAck',
			requestId: 2,
			instanceId: 'stale-instance',
		},
	} as MessageEvent);
	handler({
		data: {
			type: 'exitScrollback',
			requestId: 3,
			instanceId: 'current-instance',
		},
	} as MessageEvent);
	handler({
		data: {
			type: 'scrollbackEnterAck',
			requestId: 4,
			instanceId: 'current-instance',
		},
	} as MessageEvent);
	handler({
		data: {
			type: 'tmuxEnterCopyModeAck',
			requestId: 5,
			instanceId: 'current-instance',
		},
	} as MessageEvent);

	assert.deepEqual(events, [['exit', { requestId: 3 }], ['ack', 4], ['ack', 5]]);
});

void test('XtermJsWebView message handler reports rejected scrollback enter callbacks', async () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: 'instance-1' };
	const pendingSelectionRef = { current: new Map() };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'scrollbackEnterRequested',
				instanceId: 'instance-1',
				requestId: 7,
			},
			{
				currentInstanceIdRef,
				pendingSelectionRef,
				autoFitFn: () => {},
				setInitialized: () => {},
				onScrollbackEnterRequested: async () => {
					throw new Error('enter failed');
				},
				onScrollbackEnterRequestFailure: (event, error) =>
					events.push([
						'failure',
						event,
						error instanceof Error ? error.message : String(error),
					]),
			},
		),
		true,
	);

	await Promise.resolve();

	assert.deepEqual(events, [
		[
			'failure',
			{
				instanceId: 'instance-1',
				requestId: 7,
			},
			'enter failed',
		],
	]);
});

void test('XtermJsWebView message handler reports synchronous scrollback enter callback failures', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: 'instance-1' };
	const pendingSelectionRef = { current: new Map() };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'scrollbackEnterRequested',
				instanceId: 'instance-1',
				requestId: 7,
			},
			{
				currentInstanceIdRef,
				pendingSelectionRef,
				autoFitFn: () => {},
				setInitialized: () => {},
				onScrollbackEnterRequested: () => {
					throw new Error('sync enter failed');
				},
				onScrollbackEnterRequestFailure: (event, error) =>
					events.push([
						'failure',
						event,
						error instanceof Error ? error.message : String(error),
					]),
			},
		),
		true,
	);

	assert.deepEqual(events, [
		[
			'failure',
			{
				instanceId: 'instance-1',
				requestId: 7,
			},
			'sync enter failed',
		],
	]);
});

void test('XtermJsWebView message handler isolates scrollback enter failure callback errors', async () => {
	const currentInstanceIdRef = { current: 'instance-1' };
	const pendingSelectionRef = { current: new Map() };

	assert.doesNotThrow(() =>
		handleXtermBridgeInboundMessage(
			{
				type: 'scrollbackEnterRequested',
				instanceId: 'instance-1',
				requestId: 7,
			},
			{
				currentInstanceIdRef,
				pendingSelectionRef,
				autoFitFn: () => {},
				setInitialized: () => {},
				onScrollbackEnterRequested: () => {
					throw new Error('sync enter failed');
				},
				onScrollbackEnterRequestFailure: () => {
					throw new Error('failure handler failed');
				},
			},
		),
	);

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'scrollbackEnterRequested',
				instanceId: 'instance-1',
				requestId: 8,
			},
			{
				currentInstanceIdRef,
				pendingSelectionRef,
				autoFitFn: () => {},
				setInitialized: () => {},
				onScrollbackEnterRequested: async () => {
					throw new Error('async enter failed');
				},
				onScrollbackEnterRequestFailure: () => {
					throw new Error('failure handler failed');
				},
			},
		),
		true,
	);
	await Promise.resolve();
});

void test('XtermJsWebView message handler reports missing scrollback enter callbacks', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: 'instance-1' };
	const pendingSelectionRef = { current: new Map() };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'scrollbackEnterRequested',
				instanceId: 'instance-1',
				requestId: 7,
			},
			{
				currentInstanceIdRef,
				pendingSelectionRef,
				autoFitFn: () => {},
				setInitialized: () => {},
				onScrollbackEnterRequestFailure: (event, error) =>
					events.push([
						'failure',
						event,
						error instanceof Error ? error.message : String(error),
					]),
			},
		),
		true,
	);

	assert.deepEqual(events, [
		[
			'failure',
			{
				instanceId: 'instance-1',
				requestId: 7,
			},
			'Missing scrollback enter handler.',
		],
	]);
});

void test('XtermJsWebView scrollback enter failure handler sends fallback exit', () => {
	const sent: unknown[] = [];
	const warnings: unknown[] = [];
	const handler = createScrollbackEnterRequestFailureHandler({
		logger: {
			warn: (...args: unknown[]) => warnings.push(args),
		},
		sendToWebView: (message) => sent.push(message),
	});

	handler(
		{
			instanceId: 'instance-1',
			requestId: 7,
		},
		new Error('enter failed'),
	);

	assert.deepEqual(sent, [
		{
			type: 'exitScrollback',
			requestId: 7,
			instanceId: 'instance-1',
		},
	]);
	assert.equal(warnings.length, 1);
});

void test('XtermJsWebView scrollback enter failure fallback exits pending request', () => {
	const sent: unknown[] = [];
	const handler = createScrollbackEnterRequestFailureHandler({
		sendToWebView: (message) => sent.push(message),
	});

	handler(
		{
			instanceId: 'instance-1',
			requestId: 7,
		},
		'enter failed',
	);

	assert.deepEqual(
		sent,
		[
		{
			type: 'exitScrollback',
			requestId: 7,
			instanceId: 'instance-1',
		},
		],
	);
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
		/enterDelayMs/,
		/prefixKey/,
		/copyModeKey/,
		/cancelKey/,
		/exitKey/,
		/['"]typing['"]\s*\|\s*['"]scroll['"]/,
	];

	for (const { path, content } of artifacts) {
		if (path === 'dist/index.d.ts') {
			assert.match(content, /onScrollbackBatch\?: \(event: ScrollbackBatchEvent\)/);
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
				/sendTmuxEnterCopyModeAck: \(requestId: number, instanceId: string\) => void;/,
			);
			assert.match(content, /onTmuxScrollBatch\?: \(event: ScrollbackBatchEvent\)/);
			assert.match(
				content,
				/onTmuxEnterCopyMode\?: \(event: \{\s+instanceId: string;\s+requestId: number;\s+\}\) => void;/,
			);
			assert.match(content, /emitExit\?: boolean;/);
			assert.match(
				content,
				/export type \{\s*ScrollbackBatchEvent,\s*TmuxScrollBatchEvent,\s*TouchScrollConfig\s*\}/,
			);
		} else if (path === 'dist/bridge.d.ts') {
			assert.match(content, /scrollbackEnterRequested/);
			assert.match(content, /scrollbackEnterAck/);
			assert.match(content, /tmuxEnterCopyMode/);
			assert.match(content, /tmuxEnterCopyModeAck/);
			assert.match(content, /tmuxScrollBatch/);
			assert.match(content, /TmuxScrollBatchEvent/);
			assert.match(
				content,
				/type: 'sizeChanged';\s+cols: number;\s+rows: number;\s+instanceId: string;/,
			);
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

void test('generated WebView artifacts are in sync with source', () => {
	const packageRoot = process.cwd();

	execFileSync('pnpm', ['run', 'build'], {
		cwd: packageRoot,
		stdio: 'pipe',
	});

	const changedArtifacts = execFileSync(
		'git',
		['diff', '--name-only', '--', 'dist', 'dist-internal'],
		{
			cwd: packageRoot,
			encoding: 'utf8',
		},
	)
		.split(/\r?\n/)
		.filter(Boolean);

	assert.deepEqual(changedArtifacts, []);
});
