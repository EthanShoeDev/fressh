import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	handleScrollbackBatchBridgeMessage,
	mapScrollbackBatchMessage,
} from '../src/bridge';
import {
	buildScrollbackEnterRequestFailureMessage,
	createScrollbackEnterRequestFailureHandler,
	handleXtermBridgeInboundMessage,
} from '../src/xterm-message-handler';

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
		handle({ type: 'sizeChanged', cols: 80, rows: 24 }),
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
		},
	]);
	assert.equal(warnings.length, 1);
});

void test('XtermJsWebView scrollback enter failure fallback exits pending request', () => {
	assert.deepEqual(
		buildScrollbackEnterRequestFailureMessage({
			requestId: 7,
		}),
		{
			type: 'exitScrollback',
			requestId: 7,
		},
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
		/emitExit/,
		/enterDelayMs/,
		/prefixKey/,
		/copyModeKey/,
		/cancelKey/,
		/exitKey/,
		/['"]typing['"]\s*\|\s*['"]scroll['"]/,
		/tmuxEnterCopyMode/,
		/tmuxEnterCopyModeAck/,
		/tmuxScrollBatch/,
		/TmuxScrollBatch/,
		/onTmuxScrollBatch/,
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
				/export type \{ ScrollbackBatchEvent, TouchScrollConfig \}/,
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
