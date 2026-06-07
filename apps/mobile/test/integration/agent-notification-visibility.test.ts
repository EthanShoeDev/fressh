import assert from 'node:assert/strict';
import test from 'node:test';
import {
	acknowledgeVisibleAgentNotification,
	handleAgentNotificationRoute,
	notifyAgentNotificationPending,
	subscribeAgentNotificationPending,
	type VisibleAgentNotificationSnapshot,
} from '../../src/lib/agent-notification-visibility';

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

function waitForMicrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildWorkmuxWindowOutput(windowId = '@12'): string {
	return JSON.stringify({
		sessionName: 'main',
		target: `main:${windowId}`,
		windowId,
		windowIndex: 12,
		windowName: 'mobile',
		workspaceId: 'workspace-1',
		role: 'codex',
		roleWindow: true,
		homeWindow: false,
	});
}

function createHarness() {
	let requestId = 0;
	let visibility: VisibleAgentNotificationSnapshot = {
		isFocused: true,
		isAppActive: true,
		connectionId: 'conn-1',
		channelId: 7,
		tmuxTarget: 'main',
	};
	const commands: { argv: string[]; timeoutMs: number }[] = [];
	const acknowledgements: {
		connectionId: string;
		session: string;
		windowId: string;
	}[] = [];
	const warnings: unknown[] = [];

	return {
		commands,
		acknowledgements,
		warnings,
		setVisibility(next: Partial<VisibleAgentNotificationSnapshot>) {
			visibility = { ...visibility, ...next };
			requestId += 1;
		},
		invalidateRequest() {
			requestId += 1;
		},
		options(
			runWorkmuxCommand: (argv: string[], timeoutMs: number) => Promise<string>,
		) {
			return {
				platformOS: 'android',
				connectionId: 'conn-1',
				channelId: 7,
				tmuxEnabled: true,
				tmuxTarget: 'main',
				getVisibility: () => visibility,
				nextRequestId: () => {
					requestId += 1;
					return requestId;
				},
				isCurrentRequest: (id: number) => id === requestId,
				runWorkmuxCommand: async (argv: string[], timeoutMs: number) => {
					commands.push({ argv, timeoutMs });
					return runWorkmuxCommand(argv, timeoutMs);
				},
				acknowledge: (
					connectionId: string,
					session: string,
					windowId: string,
				) => {
					acknowledgements.push({ connectionId, session, windowId });
				},
				warn: (_message: string, error: unknown) => {
					warnings.push(error);
				},
			};
		},
	};
}

void test('acknowledgeVisibleAgentNotification acknowledges current visible window', async () => {
	const harness = createHarness();

	await acknowledgeVisibleAgentNotification(
		harness.options(async () => buildWorkmuxWindowOutput()),
	);

	assert.deepEqual(harness.commands, [
		{
			argv: ['tmux', 'app', 'window', '--session', 'main'],
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'conn-1', session: 'main', windowId: '@12' },
	]);
});

void test('acknowledgeVisibleAgentNotification skips invisible or unsupported states', async () => {
	const states = [
		{ platformOS: 'ios' },
		{ connectionId: null },
		{ tmuxEnabled: false },
		{ visibility: { isFocused: false } },
		{ visibility: { isAppActive: false } },
	];

	for (const state of states) {
		const harness = createHarness();
		if (state.visibility) harness.setVisibility(state.visibility);

		await acknowledgeVisibleAgentNotification({
			...harness.options(async () => '@12'),
			...state,
		});

		assert.deepEqual(harness.commands, []);
		assert.deepEqual(harness.acknowledgements, []);
	}
});

void test('acknowledgeVisibleAgentNotification ignores stale async results', async () => {
	const staleCases: Partial<VisibleAgentNotificationSnapshot>[] = [
		{ isFocused: false },
		{ isAppActive: false },
		{ connectionId: 'conn-2' },
		{ channelId: 8 },
		{ tmuxTarget: 'other' },
	];

	for (const staleVisibility of staleCases) {
		const harness = createHarness();
		const deferred = createDeferred<string>();
		const pending = acknowledgeVisibleAgentNotification(
			harness.options(async () => deferred.promise),
		);

		harness.setVisibility(staleVisibility);
		deferred.resolve(buildWorkmuxWindowOutput());
		await pending;

		assert.deepEqual(harness.acknowledgements, []);
	}
});

void test('acknowledgeVisibleAgentNotification ignores superseded requests without visibility changes', async () => {
	const harness = createHarness();
	const deferred = createDeferred<string>();
	const pending = acknowledgeVisibleAgentNotification(
		harness.options(async () => deferred.promise),
	);

	harness.invalidateRequest();
	deferred.resolve(buildWorkmuxWindowOutput());
	await pending;

	assert.deepEqual(harness.acknowledgements, []);
});

void test('acknowledgeVisibleAgentNotification coalesces concurrent requests into one queued rerun', async () => {
	const harness = createHarness();
	const first = createDeferred<string>();
	const second = createDeferred<string>();
	let commandCount = 0;
	const runCommand = async () => {
		commandCount += 1;
		return commandCount === 1 ? first.promise : second.promise;
	};

	const firstPending = acknowledgeVisibleAgentNotification(
		harness.options(runCommand),
	);
	const queuedA = acknowledgeVisibleAgentNotification(
		harness.options(runCommand),
	);
	const queuedB = acknowledgeVisibleAgentNotification(
		harness.options(runCommand),
	);
	await waitForMicrotask();

	assert.equal(commandCount, 1);
	first.resolve(buildWorkmuxWindowOutput());
	await waitForMicrotask();
	assert.equal(commandCount, 2);
	second.resolve(buildWorkmuxWindowOutput());
	await Promise.all([firstPending, queuedA, queuedB]);

	assert.equal(commandCount, 2);
	assert.deepEqual(harness.acknowledgements, [
		{ connectionId: 'conn-1', session: 'main', windowId: '@12' },
		{ connectionId: 'conn-1', session: 'main', windowId: '@12' },
	]);
});

void test('acknowledgeVisibleAgentNotification ignores empty command output', async () => {
	const harness = createHarness();

	await acknowledgeVisibleAgentNotification(
		harness.options(async () => '  \n\n'),
	);

	assert.deepEqual(harness.acknowledgements, []);
});

void test('pending notification subscribers are notified until unsubscribed', () => {
	let calls = 0;
	const unsubscribe = subscribeAgentNotificationPending(() => {
		calls += 1;
	});

	notifyAgentNotificationPending();
	unsubscribe();
	notifyAgentNotificationPending();

	assert.equal(calls, 1);
});

void test('handleAgentNotificationRoute selects and acknowledges routed agent alert', async () => {
	const commands: { argv: string[]; timeoutMs: number }[] = [];
	const acknowledgements: {
		connectionId: string;
		session: string;
		windowId: string;
	}[] = [];
	const consumedTokens: string[] = [];
	const handled = new Set<string>();

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: 'saved-host',
		agentSession: 'work',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: (
			_connectionId,
			_session,
			_windowId,
			_eventId,
			token,
		) => {
			consumedTokens.push(token);
			return token === 'tap-token';
		},
		isRouteHandled: (key) => handled.has(key),
		markRouteHandled: (key) => handled.add(key),
		runWorkmuxCommand: async (argv, timeoutMs) => {
			commands.push({ argv, timeoutMs });
			return '';
		},
		acknowledge: (connectionId, session, windowId) => {
			acknowledgements.push({ connectionId, session, windowId });
		},
		warn: () => {},
	});

	assert.equal(handledRoute, true);
	assert.deepEqual(consumedTokens, ['tap-token']);
	assert.deepEqual(commands, [
		{
			argv: [
				'tmux',
				'app',
				'notification',
				'open',
				'--session',
				'work',
				'--window-id',
				'@12',
			],
			timeoutMs: 10_000,
		},
	]);
	assert.deepEqual(acknowledgements, [
		{ connectionId: 'saved-host', session: 'work', windowId: '@12' },
	]);
	assert.equal(
		handled.has('["saved-host","work","@12","main:@12:2000:waiting"]'),
		true,
	);
});

void test('handleAgentNotificationRoute consumes tap tokens before async routing', async () => {
	const commands: string[][] = [];
	const acknowledgements: string[] = [];
	let tokenAvailable = true;
	let resolveCommand: () => void = () => {
		throw new Error('route command was not started');
	};
	const handled = new Set<string>();
	const routeOptions = {
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => {
			if (!tokenAvailable) return false;
			tokenAvailable = false;
			return true;
		},
		isRouteHandled: (key: string) => handled.has(key),
		markRouteHandled: (key: string) => handled.add(key),
		runWorkmuxCommand: (argv: string[]) => {
			commands.push(argv);
			return new Promise<string>((resolve) => {
				resolveCommand = () => resolve('');
			});
		},
		acknowledge: (
			_connectionId: string,
			_session: string,
			windowId: string,
		) => {
			acknowledgements.push(windowId);
		},
		warn: () => {},
	};

	const firstRoute = handleAgentNotificationRoute(routeOptions);
	const secondRoute = handleAgentNotificationRoute(routeOptions);

	assert.equal(await secondRoute, false);
	assert.equal(commands.length, 1);
	resolveCommand();

	assert.equal(await firstRoute, true);
	assert.deepEqual(commands, [
		[
			'tmux',
			'app',
			'notification',
			'open',
			'--session',
			'main',
			'--window-id',
			'@12',
		],
	]);
	assert.deepEqual(acknowledgements, ['@12']);
});

void test('handleAgentNotificationRoute restores consumed token after failed routing', async () => {
	const error = new Error('select failed');
	let tokenAvailable = true;
	let commands = 0;

	const firstRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => {
			if (!tokenAvailable) return false;
			tokenAvailable = false;
			return true;
		},
		restoreAuthorizedRouteToken: () => {
			tokenAvailable = true;
			return true;
		},
		isRouteHandled: () => false,
		markRouteHandled: () => {},
		runWorkmuxCommand: async () => {
			commands += 1;
			throw error;
		},
		acknowledge: () => {},
		warn: () => {},
	});

	const secondRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => {
			if (!tokenAvailable) return false;
			tokenAvailable = false;
			return true;
		},
		restoreAuthorizedRouteToken: () => false,
		isRouteHandled: () => false,
		markRouteHandled: () => {},
		runWorkmuxCommand: async () => {
			commands += 1;
			return '';
		},
		acknowledge: () => {},
		warn: () => {},
	});

	assert.equal(firstRoute, false);
	assert.equal(secondRoute, true);
	assert.equal(commands, 2);
});

void test('handleAgentNotificationRoute falls back to stored connection id', async () => {
	const acknowledgements: {
		connectionId: string;
		session: string;
		windowId: string;
	}[] = [];

	await handleAgentNotificationRoute({
		agentConnectionId: null,
		storedConnectionId: 'saved-host',
		agentSession: null,
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => true,
		isRouteHandled: () => false,
		markRouteHandled: () => {},
		runWorkmuxCommand: async () => '',
		acknowledge: (connectionId, session, windowId) => {
			acknowledgements.push({ connectionId, session, windowId });
		},
		warn: () => {},
	});

	assert.deepEqual(acknowledgements, [
		{ connectionId: 'saved-host', session: 'main', windowId: '@12' },
	]);
});

void test('handleAgentNotificationRoute suppresses duplicate successful routes only', async () => {
	const handled = new Set<string>([
		'["saved-host","main","@12","main:@12:2000:waiting"]',
	]);
	let commands = 0;

	const duplicateHandled = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => true,
		isRouteHandled: (key) => handled.has(key),
		markRouteHandled: (key) => handled.add(key),
		runWorkmuxCommand: async () => {
			commands += 1;
			return '';
		},
		acknowledge: () => {},
		warn: () => {},
	});

	assert.equal(duplicateHandled, false);
	assert.equal(commands, 0);
});

void test('handleAgentNotificationRoute allows a later alert for the same window', async () => {
	const handled = new Set<string>([
		'["saved-host","main","@12","main:@12:2000:waiting"]',
	]);
	const commands: string[][] = [];
	const acknowledgements: string[] = [];

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:3000:done',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => true,
		isRouteHandled: (key) => handled.has(key),
		markRouteHandled: (key) => handled.add(key),
		runWorkmuxCommand: async (argv) => {
			commands.push(argv);
			return '';
		},
		acknowledge: (_connectionId, _session, windowId) => {
			acknowledgements.push(windowId);
		},
		warn: () => {},
	});

	assert.equal(handledRoute, true);
	assert.deepEqual(commands, [
		[
			'tmux',
			'app',
			'notification',
			'open',
			'--session',
			'main',
			'--window-id',
			'@12',
		],
	]);
	assert.deepEqual(acknowledgements, ['@12']);
	assert.equal(
		handled.has('["saved-host","main","@12","main:@12:3000:done"]'),
		true,
	);
});

void test('handleAgentNotificationRoute rejects forged routes without pending notification', async () => {
	let commands = 0;
	let acknowledgements = 0;
	let handledRoutes = 0;

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => false,
		isRouteHandled: () => false,
		markRouteHandled: () => {
			handledRoutes += 1;
		},
		runWorkmuxCommand: async () => {
			commands += 1;
			return '';
		},
		acknowledge: () => {
			acknowledgements += 1;
		},
		warn: () => {},
	});

	assert.equal(handledRoute, false);
	assert.equal(commands, 0);
	assert.equal(acknowledgements, 0);
	assert.equal(handledRoutes, 0);
});

void test('handleAgentNotificationRoute treats pending-token lookup failures as unhandled routes', async () => {
	const warnings: unknown[] = [];
	let commands = 0;

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => {
			throw new Error('storage unavailable');
		},
		isRouteHandled: () => false,
		markRouteHandled: () => {},
		runWorkmuxCommand: async () => {
			commands += 1;
			return '';
		},
		acknowledge: () => {},
		warn: (_message, error) => warnings.push(error),
	});

	assert.equal(handledRoute, false);
	assert.equal(commands, 0);
	assert.equal(warnings.length, 1);
});

void test('handleAgentNotificationRoute ignores routes without a tap token', async () => {
	let commands = 0;

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: null,
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => true,
		isRouteHandled: () => false,
		markRouteHandled: () => {},
		runWorkmuxCommand: async () => {
			commands += 1;
			return '';
		},
		acknowledge: () => {},
		warn: () => {},
	});

	assert.equal(handledRoute, false);
	assert.equal(commands, 0);
});

void test('handleAgentNotificationRoute rejects valid tokens for a different shell route', async () => {
	let commands = 0;
	let pendingChecks = 0;

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: 'other-host',
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => {
			pendingChecks += 1;
			return true;
		},
		isRouteHandled: () => false,
		markRouteHandled: () => {},
		runWorkmuxCommand: async () => {
			commands += 1;
			return '';
		},
		acknowledge: () => {},
		warn: () => {},
	});

	assert.equal(handledRoute, false);
	assert.equal(pendingChecks, 0);
	assert.equal(commands, 0);
});

void test('handleAgentNotificationRoute does not acknowledge or mark failed selection', async () => {
	const handled = new Set<string>();
	const warnings: unknown[] = [];
	let acknowledgements = 0;
	const error = new Error('select failed');

	const handledRoute = await handleAgentNotificationRoute({
		agentConnectionId: 'saved-host',
		storedConnectionId: null,
		agentSession: 'main',
		agentWindowId: '@12',
		agentEventId: 'main:@12:2000:waiting',
		agentTapToken: 'tap-token',
		tmuxTarget: 'main',
		consumeAuthorizedRouteToken: () => true,
		isRouteHandled: (key) => handled.has(key),
		markRouteHandled: (key) => handled.add(key),
		runWorkmuxCommand: async () => {
			throw error;
		},
		acknowledge: () => {
			acknowledgements += 1;
		},
		warn: (_message, warning) => warnings.push(warning),
	});

	assert.equal(handledRoute, false);
	assert.equal(acknowledgements, 0);
	assert.equal(handled.size, 0);
	assert.deepEqual(warnings, [error]);
});
