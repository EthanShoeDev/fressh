import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	type BridgeOutboundMessage,
	handleScrollbackBatchBridgeMessage,
	mapScrollbackBatchMessage,
} from '../src/bridge';
import {
	createScrollbackEnterRequestFailureHandler,
	handleXtermBridgeInboundMessage,
} from '../src/xterm-message-handler';
import {
	createXtermWebViewAckSenders,
	createXtermWebViewHandle,
} from '../src/xterm-webview-handle';
import { createXtermWebViewMessageHandler } from './webview-message-handler';

function withTrackedClearTimeouts(run: (cleared: unknown[]) => void): unknown[] {
	const clearTimeoutOriginal = globalThis.clearTimeout;
	const cleared: unknown[] = [];
	globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
		cleared.push(id);
		clearTimeoutOriginal(id);
	}) as typeof clearTimeout;
	try {
		run(cleared);
	} finally {
		globalThis.clearTimeout = clearTimeoutOriginal;
	}
	return cleared;
}

function readGeneratedArtifactSnapshot(
	packageRoot: string,
): { path: string; content: string }[] {
	const files: string[] = [];
	const collect = (path: string) => {
		const absolutePath = join(packageRoot, path);
		const stat = statSync(absolutePath);
		if (stat.isDirectory()) {
			for (const entry of readdirSync(absolutePath).sort()) {
				collect(`${path}/${entry}`);
			}
			return;
		}
		if (stat.isFile()) {
			files.push(path);
		}
	};

	collect('dist');
	collect('dist-internal');

	return files.sort().map((path) => ({
		path,
		content: readFileSync(join(packageRoot, path), 'utf8'),
	}));
}

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
			bridgeLoadId: 5,
			bridgeLoadToken: 'token-1',
			bridgeStartedAt: 123456,
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

void test('XtermJsWebView message handler clears pending selection timeout on response', () => {
	const events: unknown[] = [];
	const timeoutId = setTimeout(() => {}, 10_000);
	const clearTimeoutOriginal = globalThis.clearTimeout;
	const cleared: unknown[] = [];
	const pendingSelectionRef = {
		current: new Map([
			[
				11,
				{
					resolve: (value: string) => events.push(`selection:${value}`),
					timeoutId,
				},
			],
		]),
	};

	globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
		cleared.push(id);
		clearTimeoutOriginal(id);
	}) as typeof clearTimeout;
	try {
		assert.equal(
			handleXtermBridgeInboundMessage(
				{
					type: 'selection',
					requestId: 11,
					text: 'selected',
					instanceId: 'instance-1',
				},
				{
					currentInstanceIdRef: { current: 'instance-1' },
					pendingSelectionRef,
					autoFitFn: () => {},
					setInitialized: () => {},
				},
			),
			true,
		);
	} finally {
		globalThis.clearTimeout = clearTimeoutOriginal;
	}

	assert.equal(pendingSelectionRef.current.size, 0);
	assert.deepEqual(events, ['selection:selected']);
	assert.deepEqual(cleared, [timeoutId]);
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

void test('XtermJsWebView message handler drops invalidated non-initialized messages', () => {
	const events: unknown[] = [];

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'input',
				str: 'stale',
				instanceId: 'old-instance',
			},
			{
				currentInstanceIdRef: { current: null },
				invalidatedInstanceIdsRef: {
					current: new Set<string>(['old-instance']),
				},
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => {},
				setInitialized: () => {},
				onData: (data) => events.push(`data:${data}`),
			},
		),
		true,
	);

	assert.deepEqual(events, [
		[
			'warn',
			['dropping invalidated webview message', 'input', 'old-instance'],
		],
	]);
});

void test('XtermJsWebView message handler drops non-initialized messages from a prior load generation', () => {
	const events: unknown[] = [];

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'sizeChanged',
				cols: 120,
				rows: 40,
				instanceId: 'old-instance',
				bridgeLoadId: 1,
				bridgeLoadToken: 'old-token',
			},
			{
				currentInstanceIdRef: { current: null },
				expectedBridgeLoadIdRef: { current: 2 },
				currentBridgeLoadTokenRef: { current: 'new-token' },
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
			[
				'dropping stale webview message load',
				'sizeChanged',
				'old-instance',
			],
		],
	]);
});

void test('XtermJsWebView message handler drops legacy non-initialized messages after a load reset', () => {
	const events: unknown[] = [];

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'scrollbackBatch',
				direction: 'down',
				pages: 1,
				lines: 0,
				pageStep: 24,
				instanceId: 'legacy-instance',
			},
			{
				currentInstanceIdRef: { current: null },
				awaitingBridgeDocumentStartRef: { current: true },
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => {},
				setInitialized: () => {},
				onScrollbackBatch: (event) => events.push(['scroll-batch', event]),
			},
		),
		true,
	);

	assert.deepEqual(events, [
		[
			'warn',
			[
				'dropping stale webview message generation',
				'scrollbackBatch',
				'legacy-instance',
			],
		],
	]);
});

void test('XtermJsWebView message handler records the active bridge document token', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: 'old-instance' as string | null };
	const currentBridgeLoadTokenRef = { current: null as string | null };
	const awaitingBridgeDocumentStartRef = { current: true };
	const timeoutId = setTimeout(() => {}, 10_000);
	const pendingSelectionRef = {
		current: new Map<
			number,
			{ resolve: (value: string) => void; timeoutId?: ReturnType<typeof setTimeout> }
		>([
			[
				1,
				{
					resolve: (value) => events.push(`selection:${value}`),
					timeoutId,
				},
			],
		]),
	};

	const cleared = withTrackedClearTimeouts(() => {
		assert.equal(
			handleXtermBridgeInboundMessage(
				{
					type: 'documentStarted',
					bridgeLoadId: 2,
					bridgeLoadToken: 'new-token',
				},
				{
					currentInstanceIdRef,
					expectedBridgeLoadIdRef: { current: 2 },
					currentBridgeLoadTokenRef,
					awaitingBridgeDocumentStartRef,
					pendingSelectionRef,
					autoFitFn: () => {},
					setInitialized: () => {},
				},
			),
			true,
		);
	});

	assert.equal(currentInstanceIdRef.current, null);
	assert.equal(currentBridgeLoadTokenRef.current, 'new-token');
	assert.equal(awaitingBridgeDocumentStartRef.current, false);
	assert.equal(pendingSelectionRef.current.size, 0);
	assert.deepEqual(cleared, [timeoutId]);
	assert.deepEqual(events, ['selection:']);
});

void test('XtermJsWebView message handler drops stale bridge document load ids', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const currentBridgeLoadTokenRef = { current: null as string | null };
	const awaitingBridgeDocumentStartRef = { current: true };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'documentStarted',
				bridgeLoadId: 1,
				bridgeLoadToken: 'old-token',
			},
			{
				currentInstanceIdRef,
				expectedBridgeLoadIdRef: { current: 2 },
				currentBridgeLoadTokenRef,
				awaitingBridgeDocumentStartRef,
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => {},
				setInitialized: () => {},
			},
		),
		true,
	);

	assert.equal(currentBridgeLoadTokenRef.current, null);
	assert.equal(awaitingBridgeDocumentStartRef.current, true);
	assert.deepEqual(events, [
		[
			'warn',
			['dropping stale webview documentStarted load', 'old-token'],
		],
	]);
});

void test('XtermJsWebView message handler drops invalidated bridge document tokens', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const currentBridgeLoadTokenRef = { current: null as string | null };
	const awaitingBridgeDocumentStartRef = { current: true };
	const pendingSelectionRef = {
		current: new Map<number, { resolve: (value: string) => void }>([
			[1, { resolve: (value) => events.push(`selection:${value}`) }],
		]),
	};

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'documentStarted',
				bridgeLoadId: 2,
				bridgeLoadToken: 'old-token',
			},
			{
				currentInstanceIdRef,
				expectedBridgeLoadIdRef: { current: 2 },
				invalidatedBridgeLoadTokensRef: {
					current: new Set<string>(['old-token']),
				},
				currentBridgeLoadTokenRef,
				awaitingBridgeDocumentStartRef,
				pendingSelectionRef,
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => {},
				setInitialized: () => {},
			},
		),
		true,
	);

	assert.equal(currentBridgeLoadTokenRef.current, null);
	assert.equal(awaitingBridgeDocumentStartRef.current, true);
	assert.equal(pendingSelectionRef.current.size, 1);
	assert.deepEqual(events, [
		[
			'warn',
			['dropping invalidated webview documentStarted message', 'old-token'],
		],
	]);
});

void test('XtermJsWebView message handler drops stale initialized messages', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: 'current-instance' };
	const pendingSelectionRef = {
		current: new Map<number, { resolve: (value: string) => void }>([
			[1, { resolve: (value) => events.push(`selection:${value}`) }],
		]),
	};

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'initialized',
				instanceId: 'stale-instance',
			},
			{
				currentInstanceIdRef,
				pendingSelectionRef,
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentInstanceIdRef.current, 'current-instance');
	assert.equal(pendingSelectionRef.current.has(1), true);
	assert.deepEqual(events, [
		[
			'warn',
			['dropping stale webview initialized message', 'stale-instance'],
		],
	]);
});

void test('XtermJsWebView message handler rejects malformed legacy initialized messages', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'initialized',
			} as never,
			{
				currentInstanceIdRef,
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentInstanceIdRef.current, null);
	assert.deepEqual(events, [
		['warn', ['dropping malformed webview initialized message']],
	]);
});

void test('XtermJsWebView message handler drops load-invalidated initialized messages', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const invalidatedInstanceIdsRef = {
		current: new Set<string>(['old-instance']),
	};
	const pendingSelectionRef = {
		current: new Map<number, { resolve: (value: string) => void }>([
			[1, { resolve: (value) => events.push(`selection:${value}`) }],
		]),
	};

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'initialized',
				instanceId: 'old-instance',
			},
			{
				currentInstanceIdRef,
				invalidatedInstanceIdsRef,
				pendingSelectionRef,
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentInstanceIdRef.current, null);
	assert.equal(pendingSelectionRef.current.has(1), true);
	assert.deepEqual(events, [
		[
			'warn',
			['dropping invalidated webview initialized message', 'old-instance'],
		],
	]);
});

void test('XtermJsWebView message handler drops initialized messages from a prior load generation', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const pendingSelectionRef = {
		current: new Map<number, { resolve: (value: string) => void }>([
			[1, { resolve: (value) => events.push(`selection:${value}`) }],
		]),
	};

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'initialized',
				instanceId: 'old-instance',
				bridgeLoadId: 1,
				bridgeLoadToken: 'old-token',
			},
			{
				currentInstanceIdRef,
				expectedBridgeLoadIdRef: { current: 2 },
				currentBridgeLoadTokenRef: { current: 'new-token' },
				pendingSelectionRef,
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentInstanceIdRef.current, null);
	assert.equal(pendingSelectionRef.current.has(1), true);
	assert.deepEqual(events, [
		[
			'warn',
			['dropping stale webview initialized load', 'old-instance'],
		],
	]);
});

void test('XtermJsWebView message handler drops initialized messages without generation metadata after a load reset', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'initialized',
				instanceId: 'legacy-instance',
			},
			{
				currentInstanceIdRef,
				awaitingBridgeDocumentStartRef: { current: true },
				pendingSelectionRef: { current: new Map() },
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentInstanceIdRef.current, null);
	assert.deepEqual(events, [
		[
			'warn',
			['dropping stale webview initialized generation', 'legacy-instance'],
		],
	]);
});

void test('XtermJsWebView message handler accepts initialized after load reset', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const invalidatedInstanceIdsRef = {
		current: new Set<string>(['old-instance']),
	};
	const timeoutId = setTimeout(() => {}, 10_000);
	const pendingSelectionRef = {
		current: new Map<
			number,
			{ resolve: (value: string) => void; timeoutId?: ReturnType<typeof setTimeout> }
		>([
			[
				1,
				{
					resolve: (value) => events.push(`selection:${value}`),
					timeoutId,
				},
			],
		]),
	};

	const cleared = withTrackedClearTimeouts(() => {
		assert.equal(
			handleXtermBridgeInboundMessage(
				{
					type: 'initialized',
					instanceId: 'new-instance',
					bridgeLoadId: 2,
					bridgeLoadToken: 'new-token',
				},
				{
					currentInstanceIdRef,
					invalidatedInstanceIdsRef,
					expectedBridgeLoadIdRef: { current: 2 },
					currentBridgeLoadTokenRef: { current: 'new-token' },
					pendingSelectionRef,
					onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
					autoFitFn: () => events.push('fit'),
					setInitialized: (initialized) => events.push(`state:${initialized}`),
				},
			),
			true,
		);
	});

	assert.equal(currentInstanceIdRef.current, 'new-instance');
	assert.equal(invalidatedInstanceIdsRef.current.size, 0);
	assert.equal(pendingSelectionRef.current.size, 0);
	assert.deepEqual(cleared, [timeoutId]);
	assert.deepEqual(events, [
		'selection:',
		'initialized:new-instance',
		'fit',
		'state:true',
	]);
});

void test('XtermJsWebView message handler accepts document start without load id before initialized load id arrives', () => {
	const events: unknown[] = [];
	const currentInstanceIdRef = { current: null as string | null };
	const currentBridgeLoadTokenRef = { current: null as string | null };
	const awaitingBridgeDocumentStartRef = { current: true };
	const pendingSelectionRef = { current: new Map() };

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'documentStarted',
				bridgeLoadToken: 'new-token',
			} as never,
			{
				currentInstanceIdRef,
				expectedBridgeLoadIdRef: { current: 2 },
				currentBridgeLoadTokenRef,
				awaitingBridgeDocumentStartRef,
				pendingSelectionRef,
				logger: { warn: (...args: unknown[]) => events.push(['warn', args]) },
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentBridgeLoadTokenRef.current, 'new-token');
	assert.equal(awaitingBridgeDocumentStartRef.current, false);

	assert.equal(
		handleXtermBridgeInboundMessage(
			{
				type: 'initialized',
				instanceId: 'new-instance',
				bridgeLoadId: 2,
				bridgeLoadToken: 'new-token',
			},
			{
				currentInstanceIdRef,
				expectedBridgeLoadIdRef: { current: 2 },
				currentBridgeLoadTokenRef,
				awaitingBridgeDocumentStartRef,
				pendingSelectionRef,
				onInitialized: (instanceId) => events.push(`initialized:${instanceId}`),
				autoFitFn: () => events.push('fit'),
				setInitialized: (initialized) => events.push(`state:${initialized}`),
			},
		),
		true,
	);

	assert.equal(currentInstanceIdRef.current, 'new-instance');
	assert.deepEqual(events, [
		'initialized:new-instance',
		'fit',
		'state:true',
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

void test('public tmux ack handle sends the legacy tmux ack type', () => {
	const messages: unknown[] = [];
	const sendToWebView = (message: BridgeOutboundMessage) => messages.push(message);
	const handle = createXtermWebViewHandle({
		write: () => {},
		writeMany: () => {},
		flush: () => {},
		sendToWebView,
		webRef: { current: null },
		setSystemKeyboardEnabled: () => {},
		setSelectionModeEnabled: () => {},
		getSelection: () => Promise.resolve(''),
		autoFitFn: () => {},
		appliedSizeRef: { current: null },
		fit: () => {},
		...createXtermWebViewAckSenders(sendToWebView),
	});

	handle.sendTmuxEnterCopyModeAck(5, 'current-instance');

	assert.deepEqual(messages, [
		{
			type: 'tmuxEnterCopyModeAck',
			requestId: 5,
			instanceId: 'current-instance',
		},
	]);
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
			'dist/xterm-webview-handle.d.ts',
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
				assert.match(content, /onTmuxScrollBatch\?: \(event: ScrollbackBatchEvent\)/);
			assert.match(
				content,
				/onTmuxEnterCopyMode\?: \(event: \{\s+instanceId: string;\s+requestId: number;\s+\}\) => void;/,
			);
				assert.match(content, /type: 'data';\s+data: Uint8Array;/);
				assert.match(
					content,
					/export type XtermInbound = BridgeInboundDraftMessage \| LegacyXtermInbound;/,
				);
				assert.match(
					content,
					/export type \{\s*ScrollbackBatchEvent,\s*TmuxScrollBatchEvent,\s*TouchScrollConfig,\s*XtermWebViewHandle,\s*\}/,
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
				assert.match(content, /bridgeLoadId: number/);
				assert.match(content, /bridgeLoadToken: string/);
				assert.match(
					content,
					/type TmuxScrollBatchEvent = ScrollbackBatchEvent;/,
				);
			} else if (path === 'dist/xterm-webview-handle.d.ts') {
				assert.match(
					content,
					/sendScrollbackEnterAck: \(requestId: number, instanceId: string\) => void;/,
				);
				assert.match(
					content,
					/sendTmuxEnterCopyModeAck: \(requestId: number, instanceId: string\) => void;/,
				);
				assert.match(content, /emitExit\?: boolean;/);
			} else {
			assert.match(content, /pageStep/);
			assert.match(content, /scrollbackEnterRequested/);
			assert.match(content, /scrollbackEnterAck/);
			assert.match(content, /tmuxEnterCopyModeAck/);
			assert.doesNotMatch(
				content,
				/sendTmuxEnterCopyModeAck:\s*sendScrollbackEnterAck/,
			);
		}
		for (const removedContract of removedContracts) {
			assert.doesNotMatch(content, removedContract);
		}
	}
});

void test('generated WebView artifacts are in sync with source', () => {
	const packageRoot = process.cwd();
	const beforeBuild = readGeneratedArtifactSnapshot(packageRoot);

	execFileSync('pnpm', ['run', 'build'], {
		cwd: packageRoot,
		stdio: 'pipe',
	});

	assert.deepEqual(readGeneratedArtifactSnapshot(packageRoot), beforeBuild);
});
