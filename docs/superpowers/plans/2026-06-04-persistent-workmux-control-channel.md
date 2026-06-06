# Persistent Workmux Control Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile `WorkmuxControlChannel` slice that restores fast scrollback through a persistent DirectMux shell and centralizes generic Workmux command routing behind `command(argv)`.

**Architecture:** Add a mobile-side channel abstraction with two transports: `command(argv)` uses the existing one-shot `mdev` remote command path for now, while `scroll` uses a persistent hidden shell that writes direct tmux commands without opening a new SSH exec per gesture batch. UI and keyboard code call the channel instead of deciding between side-channel, direct tmux, or one-shot command execution.

**Tech Stack:** Expo React Native, TypeScript, `@fressh/react-native-uniffi-russh` SSH shell APIs, Node `tsx --test` integration tests, ADB scroll trace tooling.

---

## Scope

This plan implements the mobile channel slice only. It does not implement the remote `mdev bridge --jsonl`; that is a separate subsystem in the `mdev` repository and should get its own plan after this mobile slice proves the channel shape and fixes the scroll UX regression.

## File Structure

- Create `apps/mobile/src/lib/workmux-control-channel.ts`
  - Owns the public `WorkmuxControlChannel` API.
  - Converts `argv` arrays into shell-safe `mdev` commands for the fallback command path.
  - Creates the DirectMux-backed scroll transport.
- Create `apps/mobile/src/lib/workmux-direct-tmux-control.ts`
  - Owns persistent hidden shell lifecycle and direct tmux command builders.
  - Contains all direct tmux command strings used by mobile.
- Create `apps/mobile/test/integration/workmux-control-channel.test.ts`
  - Tests argv command formatting, fallback command routing, and channel disposal.
- Create `apps/mobile/test/integration/workmux-direct-tmux-control.test.ts`
  - Tests tmux command escaping, scroll command building, shell reuse, failure recovery, and disposal.
- Modify `apps/mobile/src/lib/workmux-app-commands.ts`
  - Add argv builders for existing Workmux app commands.
  - Keep string builders as wrappers so current call sites remain compatible.
- Modify `apps/mobile/src/lib/workmux-scrollback-executor.ts`
  - Route enter/move/exit through typed scroll methods instead of building one-shot `mdev` scroll commands.
  - Preserve serialization, coalescing, generation cancellation, and tracing.
- Modify `apps/mobile/src/lib/tmux-scrollback.ts`
  - Pass target/session names into the executor instead of prebuilt scroll command strings.
  - Keep local UI recovery semantics for stale and inactive scrollback state.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Prefer `runWorkmuxCommand(argv)` for Workmux keyboard actions.
  - Keep existing `runHostCommand(command)` fallback during migration.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Create and dispose one `WorkmuxControlChannel` per active connection/session.
  - Pass channel scroll methods to scrollback executor.
  - Pass channel generic command runner to Workmux keyboard actions.
- Modify `apps/mobile/src/lib/scroll-trace.ts`
  - Restore env-gated tracing after manual debugging is complete.

---

### Task 1: Add argv Builders For Workmux App Commands

**Files:**
- Modify: `apps/mobile/src/lib/workmux-app-commands.ts`
- Test: `apps/mobile/test/integration/workmux-app-commands.test.ts`

- [ ] **Step 1: Write failing tests for argv builders**

Append these tests to `apps/mobile/test/integration/workmux-app-commands.test.ts`:

```ts
void test('Workmux app argv builders preserve existing command shapes', () => {
	assert.deepEqual(buildWorkmuxAppContextArgv('main'), [
		'tmux',
		'app',
		'context',
		'--session',
		'main',
	]);
	assert.deepEqual(buildWorkmuxAppWindowArgv("main'quoted"), [
		'tmux',
		'app',
		'window',
		'--session',
		"main'quoted",
	]);
	assert.deepEqual(buildWorkmuxAppFocusArgv('main', 'codex'), [
		'tmux',
		'app',
		'focus',
		'codex',
		'--session',
		'main',
	]);
	assert.deepEqual(buildWorkmuxAppNavArgv('main', 'next-all'), [
		'tmux',
		'app',
		'nav',
		'next-all',
		'--session',
		'main',
	]);
	assert.deepEqual(buildWorkmuxAppNavArgv('main', 'select', 7), [
		'tmux',
		'app',
		'nav',
		'select',
		'7',
		'--session',
		'main',
	]);
});

void test('Workmux app command builders are derived from argv builders', () => {
	assert.equal(
		buildWorkmuxAppFocusCommand("main'quoted", 'git'),
		"mdev tmux app focus git --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'select', 3),
		"mdev tmux app nav select 3 --session main",
	);
});
```

Also add these imports at the top of the test file:

```ts
import {
	buildWorkmuxAppContextArgv,
	buildWorkmuxAppFocusArgv,
	buildWorkmuxAppNavArgv,
	buildWorkmuxAppWindowArgv,
} from '../../src/lib/workmux-app-commands';
```

If the file already imports from `workmux-app-commands`, merge these names into the existing import instead of creating a duplicate import.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-app-commands.test.ts
```

Expected: FAIL because `buildWorkmuxAppContextArgv`, `buildWorkmuxAppWindowArgv`, `buildWorkmuxAppFocusArgv`, and `buildWorkmuxAppNavArgv` are not exported.

- [ ] **Step 3: Implement argv builders**

In `apps/mobile/src/lib/workmux-app-commands.ts`, add these helpers near the existing command builders:

```ts
function buildMdevCommandFromArgv(argv: string[]): string {
	return ['mdev', ...argv].map(quoteShellValue).join(' ');
}

export function buildWorkmuxAppContextArgv(sessionName: string): string[] {
	return ['tmux', 'app', 'context', '--session', normalizeSessionName(sessionName)];
}

export function buildWorkmuxAppWindowArgv(sessionName: string): string[] {
	return ['tmux', 'app', 'window', '--session', normalizeSessionName(sessionName)];
}

export function buildWorkmuxAppNotificationOpenArgv(
	sessionName: string,
	windowId: string,
): string[] {
	return [
		'tmux',
		'app',
		'notification',
		'open',
		'--session',
		normalizeSessionName(sessionName),
		'--window-id',
		windowId,
	];
}

export function buildWorkmuxAppFocusArgv(
	sessionName: string,
	roleOrDirection: WorkmuxFocusTarget,
): string[] {
	return [
		'tmux',
		'app',
		'focus',
		roleOrDirection,
		'--session',
		normalizeSessionName(sessionName),
	];
}

export function buildWorkmuxAppNavArgv(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
): string[] {
	if (action === 'select') {
		if (index === undefined) {
			throw new Error('Missing Workmux nav select index');
		}
		if (!isSafeNonNegativeInteger(index)) {
			throw new Error(`Invalid Workmux nav select index: ${index}`);
		}
		return [
			'tmux',
			'app',
			'nav',
			action,
			String(index),
			'--session',
			normalizeSessionName(sessionName),
		];
	}

	if (index !== undefined) {
		throw new Error(`Unexpected Workmux nav index for action: ${action}`);
	}

	return [
		'tmux',
		'app',
		'nav',
		action,
		'--session',
		normalizeSessionName(sessionName),
	];
}
```

Then update the existing string builders to wrap the argv builders:

```ts
export function buildWorkmuxAppContextCommand(sessionName: string): string {
	return buildMdevCommandFromArgv(buildWorkmuxAppContextArgv(sessionName));
}

export function buildWorkmuxAppWindowCommand(sessionName: string): string {
	return buildMdevCommandFromArgv(buildWorkmuxAppWindowArgv(sessionName));
}

export function buildWorkmuxAppNotificationOpenCommand(
	sessionName: string,
	windowId: string,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppNotificationOpenArgv(sessionName, windowId),
	);
}

export function buildWorkmuxAppFocusCommand(
	sessionName: string,
	roleOrDirection: WorkmuxFocusTarget,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppFocusArgv(sessionName, roleOrDirection),
	);
}

export function buildWorkmuxAppNavCommand(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
): string {
	return buildMdevCommandFromArgv(
		buildWorkmuxAppNavArgv(sessionName, action, index),
	);
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-app-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/workmux-app-commands.ts apps/mobile/test/integration/workmux-app-commands.test.ts
git commit -m "Add Workmux app argv builders"
```

---

### Task 2: Add Persistent DirectMux Control Transport

**Files:**
- Create: `apps/mobile/src/lib/workmux-direct-tmux-control.ts`
- Test: `apps/mobile/test/integration/workmux-direct-tmux-control.test.ts`

- [ ] **Step 1: Write failing tests for tmux command builders and shell reuse**

Create `apps/mobile/test/integration/workmux-direct-tmux-control.test.ts`:

```ts
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
		"tmux send-keys -t main -N 3 -X scroll-down",
	);
	assert.equal(
		buildDirectTmuxScrollMoveCommand({
			sessionName: 'main',
			direction: 'up',
			unit: 'page',
			count: 2,
		}),
		"tmux send-keys -t main -N 2 -X page-up",
	);
	assert.equal(
		buildDirectTmuxScrollExitCommand('main'),
		"tmux send-keys -t main q",
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-direct-tmux-control.test.ts
```

Expected: FAIL because `workmux-direct-tmux-control.ts` does not exist.

- [ ] **Step 3: Implement the DirectMux transport**

Create `apps/mobile/src/lib/workmux-direct-tmux-control.ts`:

```ts
import {
	type WorkmuxScrollDirection,
} from './workmux-app-commands';

export type DirectTmuxShellLike = {
	channelId: number;
	addListener?: (
		listener: (event: unknown) => void,
		options: { cursor: { mode: 'live' } },
	) => bigint;
	removeListener?: (listenerId: bigint) => void;
	sendData: (bytes: ArrayBuffer, opts?: { signal?: AbortSignal }) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type DirectTmuxConnectionLike = {
	startShell: (options: {
		term: 'Xterm';
		useTmux: false;
		tmuxSessionName: '';
		abortSignal?: AbortSignal;
		registerInStore?: false;
	}) => Promise<DirectTmuxShellLike>;
};

export type DirectTmuxScrollMove = {
	sessionName: string;
	direction: WorkmuxScrollDirection;
	unit: 'line' | 'page';
	count: number;
};

export type DirectTmuxControlTransport = {
	send: (command: string) => Promise<boolean>;
	dispose: () => Promise<void>;
};

const encoder = new TextEncoder();

function quoteTmuxTarget(target: string): string {
	return /^[A-Za-z0-9_@:.=-]+$/.test(target)
		? target
		: `'${target.replace(/'/g, "'\\''")}'`;
}

function requirePositiveInteger(count: number): number {
	if (!Number.isSafeInteger(count) || count <= 0) {
		throw new Error(`Invalid DirectMux count: ${count}`);
	}
	return count;
}

export function buildDirectTmuxScrollEnterCommand(sessionName: string): string {
	return `tmux copy-mode -t ${quoteTmuxTarget(sessionName)}`;
}

export function buildDirectTmuxScrollExitCommand(sessionName: string): string {
	return `tmux send-keys -t ${quoteTmuxTarget(sessionName)} q`;
}

export function buildDirectTmuxScrollMoveCommand({
	sessionName,
	direction,
	unit,
	count,
}: DirectTmuxScrollMove): string {
	const safeCount = requirePositiveInteger(count);
	const tmuxAction =
		unit === 'page'
			? direction === 'up'
				? 'page-up'
				: 'page-down'
			: direction === 'up'
				? 'scroll-up'
				: 'scroll-down';
	return [
		'tmux send-keys',
		`-t ${quoteTmuxTarget(sessionName)}`,
		`-N ${safeCount}`,
		`-X ${tmuxAction}`,
	].join(' ');
}

export function buildDirectTmuxSelectWindowCommand(
	sessionName: string,
	windowId: string,
): string {
	return `tmux select-window -t ${quoteTmuxTarget(`${sessionName}:${windowId}`)}`;
}

export function createDirectTmuxControlTransport({
	connection,
}: {
	connection: DirectTmuxConnectionLike | null;
}): DirectTmuxControlTransport {
	let shellPromise: Promise<DirectTmuxShellLike> | null = null;
	let disposed = false;

	const getShell = async () => {
		if (!connection) throw new Error('No SSH connection available.');
		if (disposed) throw new Error('DirectMux control transport disposed.');
		shellPromise ??= connection.startShell({
			term: 'Xterm',
			useTmux: false,
			tmuxSessionName: '',
			registerInStore: false,
		});
		return shellPromise;
	};

	return {
		send: async (command) => {
			try {
				const shell = await getShell();
				await shell.sendData(encoder.encode(`${command}\n`).buffer as ArrayBuffer);
				return true;
			} catch {
				shellPromise = null;
				return false;
			}
		},
		dispose: async () => {
			disposed = true;
			const shell = await shellPromise?.catch(() => null);
			shellPromise = null;
			await shell?.close().catch(() => {});
		},
	};
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-direct-tmux-control.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/workmux-direct-tmux-control.ts apps/mobile/test/integration/workmux-direct-tmux-control.test.ts
git commit -m "Add persistent DirectMux control transport"
```

---

### Task 3: Add WorkmuxControlChannel API

**Files:**
- Create: `apps/mobile/src/lib/workmux-control-channel.ts`
- Test: `apps/mobile/test/integration/workmux-control-channel.test.ts`

- [ ] **Step 1: Write failing channel tests**

Create `apps/mobile/test/integration/workmux-control-channel.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createWorkmuxControlChannel,
	formatMdevArgvCommand,
} from '../../src/lib/workmux-control-channel';

void test('formatMdevArgvCommand shell-quotes argv safely', () => {
	assert.equal(
		formatMdevArgvCommand(['tmux', 'app', 'focus', "co'dex"]),
		"mdev tmux app focus 'co'\\''dex'",
	);
});

void test('WorkmuxControlChannel.command uses one-shot mdev fallback', async () => {
	const calls: Array<{ command: string; timeoutMs: number }> = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async (command, timeoutMs) => {
			calls.push({ command, timeoutMs });
			return { success: true, output: 'ok\n' };
		},
	});

	const result = await channel.command(['tmux', 'app', 'nav', 'next'], {
		timeoutMs: 1234,
	});

	assert.deepEqual(result, { success: true, output: 'ok\n' });
	assert.deepEqual(calls, [
		{ command: 'mdev tmux app nav next', timeoutMs: 1234 },
	]);
});

void test('WorkmuxControlChannel.scroll delegates to DirectMux transport', async () => {
	const sent: string[] = [];
	const channel = createWorkmuxControlChannel({
		connection: null,
		runRemoteCommand: async () => ({ success: true, output: '' }),
		directTmuxTransport: {
			send: async (command) => {
				sent.push(command);
				return true;
			},
			dispose: async () => {
				sent.push('__disposed__');
			},
		},
	});

	await channel.scroll.enter({ sessionName: 'main' });
	await channel.scroll.move({
		sessionName: 'main',
		direction: 'down',
		unit: 'line',
		count: 4,
	});
	await channel.scroll.exit({ sessionName: 'main' });
	await channel.dispose();

	assert.deepEqual(sent, [
		'tmux copy-mode -t main',
		'tmux send-keys -t main -N 4 -X scroll-down',
		'tmux send-keys -t main q',
		'__disposed__',
	]);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-control-channel.test.ts
```

Expected: FAIL because `workmux-control-channel.ts` does not exist.

- [ ] **Step 3: Implement the channel API**

Create `apps/mobile/src/lib/workmux-control-channel.ts`:

```ts
import {
	type DirectTmuxConnectionLike,
	type DirectTmuxControlTransport,
	buildDirectTmuxScrollEnterCommand,
	buildDirectTmuxScrollExitCommand,
	buildDirectTmuxScrollMoveCommand,
	createDirectTmuxControlTransport,
} from './workmux-direct-tmux-control';
import { type WorkmuxScrollDirection } from './workmux-app-commands';

export type WorkmuxControlCommandResult = {
	success: boolean;
	output: string;
	error?: string;
};

export type WorkmuxControlCommandOptions = {
	timeoutMs?: number;
};

export type WorkmuxScrollTarget = {
	sessionName: string;
};

export type WorkmuxScrollMove = WorkmuxScrollTarget & {
	direction: WorkmuxScrollDirection;
	unit: 'line' | 'page';
	count: number;
};

export type WorkmuxControlChannel = {
	command: (
		argv: string[],
		options?: WorkmuxControlCommandOptions,
	) => Promise<WorkmuxControlCommandResult>;
	scroll: {
		enter: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
		move: (input: WorkmuxScrollMove) => Promise<WorkmuxControlCommandResult>;
		exit: (input: WorkmuxScrollTarget) => Promise<WorkmuxControlCommandResult>;
	};
	dispose: () => Promise<void>;
};

const DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS = 10_000;

function quoteShellValue(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatMdevArgvCommand(argv: string[]): string {
	return ['mdev', ...argv].map(quoteShellValue).join(' ');
}

function successResult(): WorkmuxControlCommandResult {
	return { success: true, output: '' };
}

function failureResult(error: string): WorkmuxControlCommandResult {
	return { success: false, output: '', error };
}

export function createWorkmuxControlChannel({
	connection,
	runRemoteCommand,
	directTmuxTransport = createDirectTmuxControlTransport({ connection }),
}: {
	connection: DirectTmuxConnectionLike | null;
	runRemoteCommand: (
		command: string,
		timeoutMs: number,
	) => Promise<WorkmuxControlCommandResult>;
	directTmuxTransport?: DirectTmuxControlTransport;
}): WorkmuxControlChannel {
	const runDirect = async (
		command: string,
	): Promise<WorkmuxControlCommandResult> => {
		const sent = await directTmuxTransport.send(command);
		return sent ? successResult() : failureResult('DirectMux control unavailable.');
	};

	return {
		command: (argv, options) =>
			runRemoteCommand(
				formatMdevArgvCommand(argv),
				options?.timeoutMs ?? DEFAULT_WORKMUX_CONTROL_COMMAND_TIMEOUT_MS,
			),
		scroll: {
			enter: (input) =>
				runDirect(buildDirectTmuxScrollEnterCommand(input.sessionName)),
			move: (input) =>
				runDirect(buildDirectTmuxScrollMoveCommand(input)),
			exit: (input) =>
				runDirect(buildDirectTmuxScrollExitCommand(input.sessionName)),
		},
		dispose: () => directTmuxTransport.dispose(),
	};
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-control-channel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/workmux-control-channel.ts apps/mobile/test/integration/workmux-control-channel.test.ts
git commit -m "Add Workmux control channel API"
```

---

### Task 4: Route Scrollback Executor Through Channel Scroll Methods

**Files:**
- Modify: `apps/mobile/src/lib/workmux-scrollback-executor.ts`
- Modify: `apps/mobile/src/lib/tmux-scrollback.ts`
- Test: `apps/mobile/test/integration/tmux-scrollback-executor.test.ts`
- Test: `apps/mobile/test/integration/tmux-scrollback-events.test.ts`

- [ ] **Step 1: Write failing executor tests for typed scroll transport**

In `apps/mobile/test/integration/tmux-scrollback-executor.test.ts`, add:

```ts
void test('scrollback executor uses typed scroll transport for enter move and exit', async () => {
	const calls: string[] = [];
	const executor = createWorkmuxScrollbackCommandExecutor({
		scrollTransport: {
			enter: async ({ sessionName }) => {
				calls.push(`enter:${sessionName}`);
				return { success: true, output: '' };
			},
			move: async ({ sessionName, direction, unit, count }) => {
				calls.push(`move:${sessionName}:${direction}:${unit}:${count}`);
				return { success: true, output: '' };
			},
			exit: async ({ sessionName }) => {
				calls.push(`exit:${sessionName}`);
				return { success: true, output: '' };
			},
		},
		onFailure: () => {},
	});

	assert.equal(await executor.runEnterCommand('main'), true);
	assert.equal(
		await executor.enqueueScrollBatch([
			{ sessionName: 'main', direction: 'down', unit: 'line', count: 3 },
		]),
		true,
	);
	assert.equal(await executor.reset({ targetName: 'main' }), true);

	assert.deepEqual(calls, [
		'enter:main',
		'move:main:down:line:3',
		'exit:main',
	]);
});
```

Update imports in that test file if needed:

```ts
import assert from 'node:assert/strict';
```

- [ ] **Step 2: Run executor tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/tmux-scrollback-executor.test.ts
```

Expected: FAIL because `createWorkmuxScrollbackCommandExecutor` does not accept `scrollTransport`, `runEnterCommand('main')`, or `reset({ targetName })` yet.

- [ ] **Step 3: Update executor types and implementation**

In `apps/mobile/src/lib/workmux-scrollback-executor.ts`, import channel types:

```ts
import {
	type WorkmuxControlCommandResult,
	type WorkmuxControlChannel,
} from './workmux-control-channel';
```

Replace the public executor method signatures with target-oriented calls:

```ts
export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (targetName: string) => Promise<boolean>;
	enqueueScrollBatch: (
		commands: WorkmuxScrollbackPageCommand[],
	) => Promise<boolean>;
	reset: (options?: {
		targetName?: string;
		failurePolicy?: WorkmuxScrollbackFailurePolicy;
	}) => Promise<boolean> | null;
	dispose: (options?: { targetName?: string }) => Promise<boolean> | null;
};
```

Change the factory input from `executeCommand` to `scrollTransport`:

```ts
export function createWorkmuxScrollbackCommandExecutor({
	scrollTransport,
	onFailure,
	onDisposeExitFailure,
	onTrace,
}: {
	scrollTransport: WorkmuxControlChannel['scroll'];
	onFailure: (
		message: string,
		context: WorkmuxScrollbackFailureContext,
	) => void;
	onDisposeExitFailure?: (message: string) => void;
	onTrace?: ScrollTraceSink;
}): WorkmuxScrollbackCommandExecutor {
```

Replace string-command execution with typed operations:

```ts
async function runSingleCommand(
	operation: () => Promise<WorkmuxControlCommandResult>,
): Promise<WorkmuxScrollbackCommandResult> {
	try {
		return await operation();
	} catch (error) {
		return {
			success: false,
			output: '',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
```

Update `runCommands` so its `commands` array is an array of async operations:

```ts
const runCommands = async ({
	commands,
	commandKind,
	operationGeneration,
	durableExit = false,
	failurePolicy = 'notify',
}: {
	commands: (() => Promise<WorkmuxControlCommandResult>)[];
	commandKind: WorkmuxScrollbackCommandKind;
	operationGeneration: number;
	durableExit?: boolean;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}) => {
```

Inside the loop, call:

```ts
const result = await runSingleCommand(command);
```

Replace `runScrollCommands` with:

```ts
const runScrollCommands = ({
	commands,
	operationGeneration,
}: {
	commands: WorkmuxScrollbackPageCommand[];
	operationGeneration: number;
}) => {
	const operations = mergeWorkmuxScrollbackPageCommands(commands).map(
		(command) => () => scrollTransport.move(command),
	);
	return runCommands({
		commands: operations,
		commandKind: 'scroll',
		operationGeneration,
	});
};
```

Update `runEnterCommand`, `reset`, and `dispose`:

```ts
runEnterCommand: (targetName: string) =>
	closed || disposed
		? Promise.resolve(false)
		: (() => {
				pendingEnterOperations += 1;
				const operationGeneration = workGeneration;
				return enqueueSerialized(async () => {
					try {
						return await runCommands({
							commands: [() => scrollTransport.enter({ sessionName: targetName })],
							commandKind: 'enter',
							operationGeneration,
						});
					} finally {
						pendingEnterOperations -= 1;
					}
				});
			})(),
reset: (options?: {
	targetName?: string;
	failurePolicy?: WorkmuxScrollbackFailurePolicy;
}) => {
	const hadPendingEnter = pendingEnterOperations > 0;
	const hadSerializedWork = pendingSerializedOperations > 0;
	canceledEnterRollbackSucceeded = true;
	canceledEnterRollbackFailurePolicy = options?.failurePolicy ?? 'notify';
	workGeneration += 1;
	clearPendingScrollBatches();
	const targetName = options?.targetName;
	if (disposed) return null;
	if (!targetName) {
		if (!hadPendingEnter || !hadSerializedWork) return null;
		return enqueueSerialized(async () => canceledEnterRollbackSucceeded);
	}
	exitGeneration += 1;
	const operationGeneration = exitGeneration;
	return enqueueSerialized(() =>
		runCommands({
			commands: [() => scrollTransport.exit({ sessionName: targetName })],
			commandKind: 'scroll',
			operationGeneration,
			durableExit: true,
			failurePolicy: options?.failurePolicy,
		}),
	);
},
dispose: (options?: { targetName?: string }) => {
	closed = true;
	const exit = reset({
		targetName: options?.targetName,
		failurePolicy: 'suppress',
	});
	if (exit) {
		void exit.finally(() => {
			disposed = true;
		});
	} else {
		disposed = true;
	}
	return exit;
},
```

Remove command-string-only helpers that are no longer needed:

```ts
executeWorkmuxScrollbackRemoteCommand
isWorkmuxScrollExitCommand
isAlreadyInactiveWorkmuxScrollExitResult
```

- [ ] **Step 4: Update tmux scrollback helper call sites**

In `apps/mobile/src/lib/tmux-scrollback.ts`, change cleanup calls from `remoteCopyModeExitCommand` to `targetName`:

```ts
return (
	commandExecutor?.reset({
		targetName,
		failurePolicy,
	}) ?? null
);
```

In `handleTmuxScrollbackEnterRequested`, replace:

```ts
const enterCommand = buildWorkmuxAppScrollEnterCommand(targetName);
const exitCommand = buildWorkmuxAppScrollExitCommand(targetName);
const entered = await commandExecutor.runEnterCommand(enterCommand, {
	rollbackExitCommand: exitCommand,
});
```

with:

```ts
const entered = await commandExecutor.runEnterCommand(targetName);
```

Keep the existing `remoteCopyModeActiveRef.current = true` and `sendScrollbackEnterAck(...)` behavior after a successful enter.

- [ ] **Step 5: Run scrollback tests and verify they pass**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test \
	test/integration/tmux-scrollback-executor.test.ts \
	test/integration/tmux-scrollback-events.test.ts \
	test/integration/tmux-scrollback-cleanup.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/workmux-scrollback-executor.ts apps/mobile/src/lib/tmux-scrollback.ts apps/mobile/test/integration/tmux-scrollback-executor.test.ts apps/mobile/test/integration/tmux-scrollback-events.test.ts apps/mobile/test/integration/tmux-scrollback-cleanup.test.ts
git commit -m "Route scrollback executor through Workmux control scroll"
```

---

### Task 5: Integrate WorkmuxControlChannel In Shell Detail

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Test: `apps/mobile/test/integration/tmux-scrollback-events.test.ts`

- [ ] **Step 1: Update the shell imports**

In `apps/mobile/src/app/shell/detail.tsx`, remove the `executeWorkmuxScrollbackRemoteCommand` import from `workmux-scrollback-executor`.

Add:

```ts
import {
	createWorkmuxControlChannel,
	type WorkmuxControlChannel,
} from '@/lib/workmux-control-channel';
```

- [ ] **Step 2: Create the channel in `ShellDetail`**

Near the existing `workmuxScrollbackCommandExecutor` `useMemo`, add:

```ts
const workmuxControlChannel = useMemo<WorkmuxControlChannel>(
	() =>
		createWorkmuxControlChannel({
			connection,
			runRemoteCommand: (command, timeoutMs) => {
				if (!connection) {
					return Promise.resolve({
						success: false,
						output: '',
						error: 'No SSH connection available for Workmux control.',
					});
				}
				return executeRemoteCommand({
					connection,
					command,
					timeoutMs,
				});
			},
		}),
	[connection],
);
```

If `executeRemoteCommand` is not imported in `detail.tsx`, import it:

```ts
import { executeRemoteCommand } from '@/lib/remote-command-runner';
```

Then add cleanup:

```ts
useEffect(() => {
	return () => {
		void workmuxControlChannel.dispose().catch((error: unknown) => {
			logger.warn('Workmux control channel dispose failed', error);
		});
	};
}, [workmuxControlChannel]);
```

- [ ] **Step 3: Pass channel scroll into the scrollback executor**

Replace the executor factory block:

```ts
return createWorkmuxScrollbackCommandExecutor({
	executeCommand: async (command) => {
		if (!connection) {
			return {
				success: false,
				output: '',
				error: `No SSH connection available for ${executorTargetName}.`,
			};
		}
		return executeWorkmuxScrollbackRemoteCommand({
			connection,
			command,
			timeoutMs: WORKMUX_SCROLLBACK_COMMAND_TIMEOUT_MS,
		});
	},
	onFailure: handleWorkmuxScrollbackCommandFailure,
	onDisposeExitFailure: (message) =>
		handleShellWorkmuxScrollbackDisposeExitFailureActions({
			message,
			warn: (warning) => logger.warn(warning),
		}),
	onTrace: traceScroll,
});
```

with:

```ts
return createWorkmuxScrollbackCommandExecutor({
	scrollTransport: {
		enter: async (input) => {
			if (!connection) {
				return {
					success: false,
					output: '',
					error: `No SSH connection available for ${executorTargetName}.`,
				};
			}
			return workmuxControlChannel.scroll.enter(input);
		},
		move: async (input) => {
			if (!connection) {
				return {
					success: false,
					output: '',
					error: `No SSH connection available for ${executorTargetName}.`,
				};
			}
			return workmuxControlChannel.scroll.move(input);
		},
		exit: async (input) => {
			if (!connection) {
				return {
					success: false,
					output: '',
					error: `No SSH connection available for ${executorTargetName}.`,
				};
			}
			return workmuxControlChannel.scroll.exit(input);
		},
	},
	onFailure: handleWorkmuxScrollbackCommandFailure,
	onDisposeExitFailure: (message) =>
		handleShellWorkmuxScrollbackDisposeExitFailureActions({
			message,
			warn: (warning) => logger.warn(warning),
		}),
	onTrace: traceScroll,
});
```

Add `workmuxControlChannel` to this `useMemo` dependency list.

- [ ] **Step 4: Run typecheck and focused tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsc --noEmit --pretty false
cd apps/mobile
pnpm exec tsx --test \
	test/integration/tmux-scrollback-events.test.ts \
	test/integration/tmux-scrollback-executor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "Connect shell scrollback to Workmux control channel"
```

---

### Task 6: Route Workmux Keyboard Actions Through `command(argv)`

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Test: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Write failing keyboard command tests**

In `apps/mobile/test/integration/keyboard-actions.test.ts`, add:

```ts
void test('Workmux keyboard runner prefers argv command transport', async () => {
	const argvCalls: string[][] = [];
	const hostCalls: string[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => 'main',
		runWorkmuxCommand: async (argv) => {
			argvCalls.push(argv);
		},
		runHostCommand: async (command) => {
			hostCalls.push(command);
		},
		showFailure: () => {},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.deepEqual(await runner.run({ type: 'nav', action: 'next-all' }), {
		status: 'handled',
	});
	assert.deepEqual(argvCalls, [
		['tmux', 'app', 'nav', 'next-all', '--session', 'main'],
	]);
	assert.deepEqual(hostCalls, []);
});

void test('Workmux keyboard runner keeps host command fallback', async () => {
	const hostCalls: string[] = [];
	const runner = createWorkmuxKeyboardCommandRunner({
		isTmuxEnabled: () => true,
		getSessionName: () => 'main',
		runHostCommand: async (command) => {
			hostCalls.push(command);
		},
		showFailure: () => {},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
	});

	assert.deepEqual(await runner.run({ type: 'focus', target: 'codex' }), {
		status: 'handled',
	});
	assert.deepEqual(hostCalls, [
		'mdev tmux app focus codex --session main',
	]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: FAIL because `createWorkmuxKeyboardCommandRunner` does not accept `runWorkmuxCommand`.

- [ ] **Step 3: Update keyboard runner**

In `apps/mobile/src/lib/keyboard-actions.ts`, import argv builders:

```ts
import {
	buildWorkmuxAppFocusArgv,
	buildWorkmuxAppNavArgv,
} from '@/lib/workmux-app-commands';
```

Update the runner factory input:

```ts
runWorkmuxCommand?: (argv: string[], timeoutMs: number) => Promise<unknown>;
runHostCommand: (command: string, timeoutMs: number) => Promise<unknown>;
```

Inside `execute`, replace remote command construction and execution with:

```ts
const argv =
	command.type === 'focus'
		? buildWorkmuxAppFocusArgv(sessionName, command.target)
		: buildWorkmuxAppNavArgv(sessionName, command.action);
if (runWorkmuxCommand) {
	await runWorkmuxCommand(argv, 10_000);
} else {
	const remoteCommand =
		command.type === 'focus'
			? buildWorkmuxAppFocusCommand(sessionName, command.target)
			: buildWorkmuxAppNavCommand(sessionName, command.action);
	await runHostCommand(remoteCommand, 10_000);
}
```

- [ ] **Step 4: Pass the channel command runner from shell detail**

In `apps/mobile/src/app/shell/detail.tsx`, update `createWorkmuxKeyboardCommandRunner`:

```ts
runWorkmuxCommand: async (argv, timeoutMs) => {
	const result = await workmuxControlChannel.command(argv, { timeoutMs });
	if (!result.success) {
		throw new Error(result.error || result.output || 'Workmux command failed.');
	}
	return result.output;
},
runHostCommand: (command, timeoutMs) =>
	workmuxKeyboardRunHostCommandRef.current(command, timeoutMs),
```

Because `workmuxKeyboardCommandRunner` is currently created with an empty
dependency array, convert `workmuxControlChannel` to a ref:

```ts
const workmuxControlChannelRef = useRef(workmuxControlChannel);
useLayoutEffect(() => {
	workmuxControlChannelRef.current = workmuxControlChannel;
}, [workmuxControlChannel]);
```

Then use:

```ts
const result = await workmuxControlChannelRef.current.command(argv, { timeoutMs });
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/keyboard-actions.test.ts
pnpm --filter @fressh/mobile exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/keyboard-actions.test.ts
git commit -m "Route Workmux keyboard actions through control channel"
```

---

### Task 7: Restore Scroll Trace Gating And Add Benchmark Gate

**Files:**
- Modify: `apps/mobile/src/lib/scroll-trace.ts`
- Modify: `apps/mobile/scripts/collect-scroll-trace.mjs`
- Test: `apps/mobile/test/integration/scroll-trace.test.ts`

- [ ] **Step 1: Write failing benchmark threshold test**

In `apps/mobile/test/integration/scroll-trace.test.ts`, add:

```ts
import { isScrollTraceSummaryHealthy } from '../../src/lib/scroll-trace';

void test('scroll trace summary health enforces latency threshold when provided', () => {
	assert.equal(
		isScrollTraceSummaryHealthy(
			{
				eventCount: 10,
				acceptedBatchCount: 3,
				droppedBatchCount: 0,
				failedCommandCount: 0,
				notInModeCount: 0,
				commandDurationMs: { avg: 12, p95: 20, max: 30 },
			},
			{ minAcceptedBatches: 1, maxAverageCommandDurationMs: 50 },
		),
		true,
	);
	assert.equal(
		isScrollTraceSummaryHealthy(
			{
				eventCount: 10,
				acceptedBatchCount: 3,
				droppedBatchCount: 0,
				failedCommandCount: 0,
				notInModeCount: 0,
				commandDurationMs: { avg: 138, p95: 182, max: 219 },
			},
			{ minAcceptedBatches: 1, maxAverageCommandDurationMs: 50 },
		),
		false,
	);
});
```

- [ ] **Step 2: Run scroll trace tests and verify they fail**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/scroll-trace.test.ts
```

Expected: FAIL because `isScrollTraceSummaryHealthy` does not exist.

- [ ] **Step 3: Restore env-gated tracing and add summary helper**

In `apps/mobile/src/lib/scroll-trace.ts`, replace the diagnostic forced return:

```ts
export function isScrollTraceEnabled(): boolean {
	return true;
}
```

with:

```ts
export function isScrollTraceEnabled(): boolean {
	return process.env.EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE === 'true';
}
```

Add:

```ts
export type ScrollTraceSummaryLike = {
	eventCount: number;
	acceptedBatchCount: number;
	droppedBatchCount: number;
	failedCommandCount: number;
	notInModeCount: number;
	commandDurationMs?: {
		avg?: number | null;
		p95?: number | null;
		max?: number | null;
	};
};

export function isScrollTraceSummaryHealthy(
	summary: ScrollTraceSummaryLike,
	options: {
		minAcceptedBatches: number;
		maxAverageCommandDurationMs?: number;
	},
): boolean {
	if (summary.eventCount === 0) return false;
	if (summary.acceptedBatchCount < options.minAcceptedBatches) return false;
	if (summary.droppedBatchCount > 0) return false;
	if (summary.failedCommandCount > 0) return false;
	if (summary.notInModeCount > 0) return false;
	if (options.maxAverageCommandDurationMs !== undefined) {
		const avg = summary.commandDurationMs?.avg;
		if (typeof avg !== 'number') return false;
		if (avg > options.maxAverageCommandDurationMs) return false;
	}
	return true;
}
```

- [ ] **Step 4: Add CLI latency threshold option**

In `apps/mobile/scripts/collect-scroll-trace.mjs`, add parser support:

```js
maxAverageCommandDurationMs: null,
```

Add the switch case:

```js
case '--max-average-command-duration-ms':
	args.maxAverageCommandDurationMs = Number(next());
	break;
```

Replace the final fail condition with:

```js
const unhealthy =
	summary.eventCount === 0 ||
	summary.acceptedBatchCount < args.minAcceptedBatches ||
	summary.failedCommandCount > 0 ||
	summary.notInModeCount > 0 ||
	(args.maxAverageCommandDurationMs !== null &&
		(typeof summary.commandDurationMs.avg !== 'number' ||
			summary.commandDurationMs.avg > args.maxAverageCommandDurationMs));

if (args.failOnScrollErrors && unhealthy) {
	process.exitCode = 1;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/scroll-trace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/scroll-trace.ts apps/mobile/scripts/collect-scroll-trace.mjs apps/mobile/test/integration/scroll-trace.test.ts
git commit -m "Restore scroll trace gating and benchmark threshold"
```

---

### Task 8: Device Verification And OTA Publish

**Files:**
- No source files expected.
- Uses: `apps/mobile/scripts/collect-scroll-trace.mjs`

- [ ] **Step 1: Run full focused verification**

Run:

```bash
pnpm --filter @fressh/mobile exec tsc --noEmit --pretty false
cd apps/mobile
pnpm exec tsx --test \
	test/integration/workmux-app-commands.test.ts \
	test/integration/workmux-direct-tmux-control.test.ts \
	test/integration/workmux-control-channel.test.ts \
	test/integration/tmux-scrollback-batch.test.ts \
	test/integration/tmux-scrollback-executor.test.ts \
	test/integration/tmux-scrollback-events.test.ts \
	test/integration/tmux-scrollback-cleanup.test.ts \
	test/integration/keyboard-actions.test.ts \
	test/integration/scroll-trace.test.ts
```

Expected: both commands PASS.

- [ ] **Step 2: Publish preview OTA with tracing enabled for manual measurement**

Run:

```bash
cd apps/mobile
EXPO_PUBLIC_FRESSH_ENABLE_SCROLL_TRACE=true pnpm exec eas update --channel preview --message "Route scroll through persistent Workmux control channel"
```

Expected: EAS prints an Android update ID for channel `preview`.

- [ ] **Step 3: Restart the app twice through USB-forwarded ADB**

Run:

```bash
export ADB_SERVER_SOCKET=tcp:100.69.79.32:5037
adb devices -l
adb shell am force-stop com.finalapp.vibe2
adb shell monkey -p com.finalapp.vibe2 -c android.intent.category.LAUNCHER 1
sleep 8
adb shell am force-stop com.finalapp.vibe2
adb shell monkey -p com.finalapp.vibe2 -c android.intent.category.LAUNCHER 1
sleep 10
adb shell pidof com.finalapp.vibe2
```

Expected: `adb devices -l` lists `R52Y903SQ7L device`; `pidof` prints a process id.

- [ ] **Step 4: Capture scroll trace benchmark**

Run:

```bash
export ADB_SERVER_SOCKET=tcp:100.69.79.32:5037
pnpm --filter @fressh/mobile trace:scroll -- \
	--out /tmp/fressh-scroll-debug/persistent-workmux-control-channel \
	--x1 300 \
	--y1 280 \
	--x2 300 \
	--y2 1050 \
	--duration-ms 3000 \
	--settle-ms 2500 \
	--fail-on-scroll-errors \
	--min-accepted-batches 1 \
	--max-average-command-duration-ms 50
```

Expected: command exits `0`, `failedCommandCount` is `0`, `notInModeCount` is `0`, and `commandDurationMs.avg` is below `50`.

- [ ] **Step 5: Manually verify UX on the device**

Use the installed preview app and confirm:

- Slow drag in scrollback moves in sync with the finger rather than jumping.
- No `Tmux scroll unavailable: not in the mode` dialog appears.
- Workmux keyboard nav/focus keys still work.
- The visible terminal remains usable after leaving and re-entering scrollback.

- [ ] **Step 6: Publish normal preview OTA with tracing disabled**

Run:

```bash
cd apps/mobile
pnpm exec eas update --channel preview --message "Restore persistent Workmux control channel without scroll tracing"
```

Expected: EAS prints a new Android update ID for channel `preview`.

- [ ] **Step 7: Commit verification notes if a notes file is created**

If implementation creates no notes file, skip this commit step. If a notes file is created, commit it:

```bash
git add docs/superpowers/plans/2026-06-04-persistent-workmux-control-channel.md
git commit -m "Document Workmux control channel verification"
```

---

## Self-Review

- Spec coverage:
  - `WorkmuxControlChannel` API: Tasks 3 and 5.
  - Fast DirectMux scroll: Tasks 2, 4, 5, and 8.
  - Generic `mdevCommand(argv)` mobile API: Tasks 1, 3, and 6.
  - Keyboard nav/focus channel routing: Task 6.
  - Error recovery and hidden channel cleanup: Tasks 2, 4, 5, and 8.
  - Trace benchmark and manual verification: Tasks 7 and 8.
  - Remote `mdev bridge --jsonl`: intentionally out of this mobile slice; write a separate plan for the `mdev` repository after this slice lands.
- Placeholder scan:
  - No task uses placeholder language.
  - The only skipped step is conditional on whether a verification notes file is created.
- Type consistency:
  - `WorkmuxControlChannel`, `WorkmuxControlCommandResult`, `WorkmuxScrollTarget`, and `WorkmuxScrollMove` are defined in Task 3 and reused consistently later.
  - `scrollTransport.enter/move/exit` signatures in Task 4 match Task 3.
  - `runWorkmuxCommand(argv, timeoutMs)` in Task 6 matches `WorkmuxControlChannel.command(argv, { timeoutMs })`.
