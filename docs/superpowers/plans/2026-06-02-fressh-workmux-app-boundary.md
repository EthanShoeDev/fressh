# Fressh Workmux App Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Fressh mobile's remaining Workmux direct-tmux behavior with the merged `mdev tmux app ...` command surface, with no legacy fallback.

**Architecture:** Add a focused mobile command-boundary module for `mdev tmux app` builders and JSON parsers. Update host browser context, notification routing, scrollback, and keyboard Workmux actions to use that boundary through the existing SSH side-channel. Finish by changing the direct-tmux source guard from a temporary allowlist to zero tolerance.

**Tech Stack:** Expo React Native, TypeScript, Node `tsx --test`, JSON runtime keyboard config, Rust `uniffi-russh` for existing attach behavior.

---

## Scope Check

The approved spec covers several user flows, but they all share one boundary:
Fressh mobile must stop using tmux as its Workmux application contract. This is
one coherent plan because each task removes one class of direct tmux dependency
and the final guard proves the boundary is complete.

## File Structure

- Create: `apps/mobile/src/lib/workmux-app-commands.ts`
  - Owns shell quoting, `mdev tmux app ...` command builders, JSON parsers, and
    Workmux app command types.
- Create: `apps/mobile/test/integration/workmux-app-commands.test.ts`
  - Focused tests for the new command boundary module.
- Modify: `apps/mobile/src/lib/host-browser-actions.ts`
  - Remove direct tmux pane/window builders and `parseTmuxPaneContextOutput`.
  - Keep URL parsing, URL slot helpers, Diffity command, `mdev open`, URL
    get/set, status cycle, and `TmuxPaneContext`.
- Modify: `apps/mobile/test/integration/host-browser-actions.test.ts`
  - Remove direct tmux expectations; keep host browser URL and `mdev open`
    command tests.
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
  - Resolve pane path/context by running `mdev tmux app context` and parsing
    JSON.
- Modify: `apps/mobile/src/lib/agent-notification-visibility.ts`
  - Route notification taps through `mdev tmux app notification open`.
  - Acknowledge visible notifications by reading `mdev tmux app window`.
- Modify: `apps/mobile/test/integration/agent-notification-visibility.test.ts`
  - Expect app commands and JSON output.
- Modify: `apps/mobile/src/lib/tmux-scrollback.ts`
  - Remove direct tmux scrollback and select-window builders.
  - Add page command planning with line accumulation.
  - Require `mdev tmux app scroll exit --session <session>` for cleanup and
    rollback after scrollback entry.
- Modify: `apps/mobile/src/app/shell/detail.tsx`
  - Send Workmux app scroll commands on touch-scroll entry and batches.
  - Add side-channel runner for keyboard Workmux app actions.
- Modify: `apps/mobile/test/integration/tmux-scrollback-batch.test.ts`
- Modify: `apps/mobile/test/integration/tmux-scrollback-cleanup.test.ts`
- Modify: `apps/mobile/test/integration/tmux-scrollback-executor.test.ts`
  - Expect `mdev tmux app scroll ...` commands and line accumulation behavior.
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
  - Add semantic Workmux action ids and delegate them to an action-context
    callback.
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Prove Workmux keyboard actions do not call `sendBytes`.
- Modify: `apps/mobile/config/shell-config.json`
  - Replace Workmux role/workspace movement byte slots with action slots.
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
  - Verify Workmux role/workspace controls are action ids.
- Modify: `apps/mobile/test/integration/direct-tmux-boundary.test.ts`
  - Make the expected direct-tmux occurrence map empty.

---

### Task 1: Add the Workmux App Command Boundary

**Files:**
- Create: `apps/mobile/test/integration/workmux-app-commands.test.ts`
- Create: `apps/mobile/src/lib/workmux-app-commands.ts`

- [ ] **Step 1: Write the failing command-boundary tests**

Create `apps/mobile/test/integration/workmux-app-commands.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	buildWorkmuxAppContextCommand,
	buildWorkmuxAppFocusCommand,
	buildWorkmuxAppNavCommand,
	buildWorkmuxAppNotificationOpenCommand,
	buildWorkmuxAppScrollEnterCommand,
	buildWorkmuxAppScrollExitCommand,
	buildWorkmuxAppScrollPageCommand,
	buildWorkmuxAppWindowCommand,
	formatWorkmuxAppCommandFailureMessage,
	parseWorkmuxAppContextOutput,
	parseWorkmuxAppWindowOutput,
	type WorkmuxAppContext,
	type WorkmuxAppWindow,
} from '../../src/lib/workmux-app-commands';

const context: WorkmuxAppContext = {
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 12,
	windowName: 'mobile',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
	paneId: '%34',
	paneTty: '/dev/pts/12',
	panePath: "/home/muly/fressh/apps/mobile's",
	projectRoot: '/home/muly/fressh',
	projectName: 'fressh',
};

const windowProjection: WorkmuxAppWindow = {
	sessionName: 'main',
	target: 'main:@12',
	windowId: '@12',
	windowIndex: 12,
	windowName: 'mobile',
	workspaceId: 'workspace-1',
	role: 'codex',
	roleWindow: true,
	homeWindow: false,
};

void test('workmux app command builders shell-quote app arguments', () => {
	assert.equal(
		buildWorkmuxAppContextCommand("main'quoted"),
		"mdev tmux app context --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppWindowCommand("main'quoted"),
		"mdev tmux app window --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppNotificationOpenCommand("main'quoted", "@12'bad"),
		"mdev tmux app notification open --session 'main'\\''quoted' --window-id '@12'\\''bad'",
	);
	assert.equal(
		buildWorkmuxAppScrollEnterCommand("main'quoted"),
		"mdev tmux app scroll enter --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppScrollExitCommand("main'quoted"),
		"mdev tmux app scroll exit --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppScrollPageCommand("main'quoted", 'up', 3),
		"mdev tmux app scroll page-up --count '3' --session 'main'\\''quoted'",
	);
	assert.equal(
		buildWorkmuxAppScrollPageCommand('main', 'down', 2),
		"mdev tmux app scroll page-down --count '2' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppFocusCommand('main', 'toggle-git-bash'),
		"mdev tmux app focus 'toggle-git-bash' --session 'main'",
	);
	assert.equal(
		buildWorkmuxAppNavCommand('main', 'select', 7),
		"mdev tmux app nav 'select' '7' --session 'main'",
	);
});

void test('workmux app builders normalize blank sessions to main', () => {
	assert.equal(
		buildWorkmuxAppContextCommand('   '),
		"mdev tmux app context --session 'main'",
	);
});

void test('workmux scroll page builder rejects invalid counts', () => {
	for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() => buildWorkmuxAppScrollPageCommand('main', 'up', count),
			/Invalid Workmux scroll count/,
		);
	}
});

void test('workmux nav select builder requires an index', () => {
	assert.throws(
		() => buildWorkmuxAppNavCommand('main', 'select'),
		/Missing Workmux nav select index/,
	);
});

void test('workmux app context parser accepts one complete JSON object', () => {
	assert.deepEqual(
		parseWorkmuxAppContextOutput(`${JSON.stringify(context)}\n`),
		context,
	);
});

void test('workmux app window parser accepts one complete JSON object', () => {
	assert.deepEqual(
		parseWorkmuxAppWindowOutput(`${JSON.stringify(windowProjection)}\n`),
		windowProjection,
	);
});

void test('workmux app parsers reject bad or ambiguous output', () => {
	for (const output of [
		'',
		'not json',
		`${JSON.stringify(context)}\n${JSON.stringify(context)}`,
		JSON.stringify({ ...context, paneId: '' }),
		JSON.stringify({ ...context, windowIndex: '12' }),
	]) {
		assert.throws(
			() => parseWorkmuxAppContextOutput(output),
			/Invalid Workmux app context/,
		);
	}

	assert.throws(
		() =>
			parseWorkmuxAppWindowOutput(
				JSON.stringify({ ...windowProjection, windowId: '' }),
			),
		/Invalid Workmux app window/,
	);
});

void test('workmux app update message is explicit', () => {
	assert.equal(
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
		'Update mdev on the remote machine; this action requires mdev tmux app commands.',
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('mdev: command not found'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('Unknown tmux app action: context'),
		WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	);
	assert.equal(
		formatWorkmuxAppCommandFailureMessage('permission denied'),
		'permission denied',
	);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/workmux-app-commands.test.ts
```

Expected: FAIL with a module resolution error for
`../../src/lib/workmux-app-commands`.

- [ ] **Step 3: Implement the command boundary module**

Create `apps/mobile/src/lib/workmux-app-commands.ts`:

```ts
export const WORKMUX_APP_COMMAND_UPDATE_MESSAGE =
	'Update mdev on the remote machine; this action requires mdev tmux app commands.';

export function formatWorkmuxAppCommandFailureMessage(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return WORKMUX_APP_COMMAND_UPDATE_MESSAGE;
	if (
		/(?:mdev|tmux): command not found/i.test(trimmed) ||
		/unknown tmux app/i.test(trimmed) ||
		/unknown tmux command/i.test(trimmed)
	) {
		return WORKMUX_APP_COMMAND_UPDATE_MESSAGE;
	}
	return trimmed;
}

export type WorkmuxAppContext = {
	sessionName: string;
	target: string;
	windowId: string;
	windowIndex: number;
	windowName: string;
	workspaceId: string;
	role: string;
	roleWindow: boolean;
	homeWindow: boolean;
	paneId: string;
	paneTty: string;
	panePath: string;
	projectRoot: string;
	projectName: string;
};

export type WorkmuxAppWindow = Pick<
	WorkmuxAppContext,
	| 'sessionName'
	| 'target'
	| 'windowId'
	| 'windowIndex'
	| 'windowName'
	| 'workspaceId'
	| 'role'
	| 'roleWindow'
	| 'homeWindow'
>;

export type WorkmuxFocusTarget =
	| 'claude'
	| 'git'
	| 'codex'
	| 'bash'
	| 'next'
	| 'prev'
	| 'toggle-git-bash';

export type WorkmuxNavAction =
	| 'next'
	| 'prev'
	| 'next-all'
	| 'prev-all'
	| 'select';

export type WorkmuxScrollDirection = 'up' | 'down';

function quoteShell(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizedSessionName(sessionName: string): string {
	const trimmed = sessionName.trim();
	return trimmed.length ? trimmed : 'main';
}

function assertPositiveInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`Invalid ${label}: ${String(value)}`);
	}
	return value;
}

export function buildWorkmuxAppContextCommand(sessionName: string): string {
	return `mdev tmux app context --session ${quoteShell(
		normalizedSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppWindowCommand(sessionName: string): string {
	return `mdev tmux app window --session ${quoteShell(
		normalizedSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppNotificationOpenCommand(
	sessionName: string,
	windowId: string,
): string {
	return [
		'mdev tmux app notification open',
		`--session ${quoteShell(normalizedSessionName(sessionName))}`,
		`--window-id ${quoteShell(windowId)}`,
	].join(' ');
}

export function buildWorkmuxAppScrollEnterCommand(
	sessionName: string,
): string {
	return `mdev tmux app scroll enter --session ${quoteShell(
		normalizedSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppScrollExitCommand(
	sessionName: string,
): string {
	return `mdev tmux app scroll exit --session ${quoteShell(
		normalizedSessionName(sessionName),
	)}`;
}

export function buildWorkmuxAppScrollPageCommand(
	sessionName: string,
	direction: WorkmuxScrollDirection,
	count: number,
): string {
	const safeCount = assertPositiveInteger(count, 'Workmux scroll count');
	const action = direction === 'up' ? 'page-up' : 'page-down';
	return [
		`mdev tmux app scroll ${action}`,
		`--count ${quoteShell(String(safeCount))}`,
		`--session ${quoteShell(normalizedSessionName(sessionName))}`,
	].join(' ');
}

export function buildWorkmuxAppFocusCommand(
	sessionName: string,
	target: WorkmuxFocusTarget,
): string {
	return [
		'mdev tmux app focus',
		quoteShell(target),
		`--session ${quoteShell(normalizedSessionName(sessionName))}`,
	].join(' ');
}

export function buildWorkmuxAppNavCommand(
	sessionName: string,
	action: WorkmuxNavAction,
	index?: number,
): string {
	const parts = ['mdev tmux app nav', quoteShell(action)];
	if (action === 'select') {
		if (index === undefined) {
			throw new Error('Missing Workmux nav select index.');
		}
		parts.push(quoteShell(String(assertPositiveInteger(index, 'Workmux nav select index'))));
	}
	parts.push(`--session ${quoteShell(normalizedSessionName(sessionName))}`);
	return parts.join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSingleJsonRecord(output: string, label: string): Record<string, unknown> {
	const rows = output
		.split(/\r?\n/)
		.map((row) => row.trim())
		.filter(Boolean);
	if (rows.length !== 1) {
		throw new Error(`Invalid ${label}: expected one JSON object.`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rows[0] ?? '');
	} catch {
		throw new Error(`Invalid ${label}: output is not JSON.`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`Invalid ${label}: output is not an object.`);
	}
	return parsed;
}

function requiredString(
	record: Record<string, unknown>,
	key: string,
	label: string,
): string {
	const value = record[key];
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Invalid ${label}: missing ${key}.`);
	}
	return value;
}

function optionalString(
	record: Record<string, unknown>,
	key: string,
	label: string,
): string {
	const value = record[key];
	if (value === undefined) return '';
	if (typeof value !== 'string') {
		throw new Error(`Invalid ${label}: invalid ${key}.`);
	}
	return value;
}

function requiredNumber(
	record: Record<string, unknown>,
	key: string,
	label: string,
): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new Error(`Invalid ${label}: missing ${key}.`);
	}
	return value;
}

function requiredBoolean(
	record: Record<string, unknown>,
	key: string,
	label: string,
): boolean {
	const value = record[key];
	if (typeof value !== 'boolean') {
		throw new Error(`Invalid ${label}: missing ${key}.`);
	}
	return value;
}

export function parseWorkmuxAppContextOutput(
	output: string,
): WorkmuxAppContext {
	const label = 'Workmux app context';
	const record = parseSingleJsonRecord(output, label);
	return {
		sessionName: requiredString(record, 'sessionName', label),
		target: requiredString(record, 'target', label),
		windowId: requiredString(record, 'windowId', label),
		windowIndex: requiredNumber(record, 'windowIndex', label),
		windowName: requiredString(record, 'windowName', label),
		workspaceId: optionalString(record, 'workspaceId', label),
		role: optionalString(record, 'role', label),
		roleWindow: requiredBoolean(record, 'roleWindow', label),
		homeWindow: requiredBoolean(record, 'homeWindow', label),
		paneId: requiredString(record, 'paneId', label),
		paneTty: requiredString(record, 'paneTty', label),
		panePath: requiredString(record, 'panePath', label),
		projectRoot: requiredString(record, 'projectRoot', label),
		projectName: requiredString(record, 'projectName', label),
	};
}

export function parseWorkmuxAppWindowOutput(output: string): WorkmuxAppWindow {
	const label = 'Workmux app window';
	const record = parseSingleJsonRecord(output, label);
	return {
		sessionName: requiredString(record, 'sessionName', label),
		target: requiredString(record, 'target', label),
		windowId: requiredString(record, 'windowId', label),
		windowIndex: requiredNumber(record, 'windowIndex', label),
		windowName: requiredString(record, 'windowName', label),
		workspaceId: optionalString(record, 'workspaceId', label),
		role: optionalString(record, 'role', label),
		roleWindow: requiredBoolean(record, 'roleWindow', label),
		homeWindow: requiredBoolean(record, 'homeWindow', label),
	};
}
```

- [ ] **Step 4: Run the command-boundary test to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/workmux-app-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/workmux-app-commands.ts apps/mobile/test/integration/workmux-app-commands.test.ts
git commit -m "feat(mobile): add Workmux app command boundary"
```

---

### Task 2: Move Host Browser Context To Workmux App Context

**Files:**
- Modify: `apps/mobile/src/lib/host-browser-actions.ts`
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/test/integration/host-browser-actions.test.ts`

- [ ] **Step 1: Update host-browser tests to remove direct tmux expectations**

In `apps/mobile/test/integration/host-browser-actions.test.ts`, update the import
list to remove:

```ts
	buildHostBrowserPaneContextCommand,
	buildHostBrowserPanePathCommand,
	buildTmuxCurrentWindowIdCommand,
	parseTmuxPaneContextOutput,
```

Add this namespace import below the existing import block:

```ts
import * as hostBrowserActions from '../../src/lib/host-browser-actions';
```

Then replace the tests named `host browser command builders shell-quote dynamic
values`, `current window id command shell-quotes tmux session`, `pane context
command shell-quotes tmux session`, `parseTmuxPaneContextOutput returns the last
complete pane context line`, and `parseTmuxPaneContextOutput rejects malformed
pane context output` with this single focused test:

```ts
void test('host browser mdev command builders shell-quote dynamic values', () => {
	assert.equal(
		buildDiffityShareCommand("/home/muly/work folder/repo's"),
		"cd '/home/muly/work folder/repo'\\''s' && mdev diffity share",
	);
	assert.equal(
		buildTmuxWindowConfigGetCommand('window-url', '/tmp/work repo'),
		"TMUX_PANE_PATH='/tmp/work repo' mdev tmux url get 'window-url'",
	);
	assert.equal(
		buildTmuxWindowConfigSetCommand(
			'dev-web-server-url',
			'/tmp/work repo',
			'https://example.com/app?q=1',
		),
		"TMUX_PANE_PATH='/tmp/work repo' mdev tmux url set-value 'dev-web-server-url' 'https://example.com/app?q=1'",
	);
	assert.equal(
		buildHostBrowserStatusCycleCommand("main'quoted"),
		"mdev tmux nav cycle 'main'\\''quoted:'",
	);
});

void test('host browser actions do not export direct tmux context helpers', () => {
	assert.equal(
		'buildHostBrowserPanePathCommand' in hostBrowserActions,
		false,
	);
	assert.equal(
		'buildHostBrowserPaneContextCommand' in hostBrowserActions,
		false,
	);
	assert.equal('buildTmuxCurrentWindowIdCommand' in hostBrowserActions, false);
	assert.equal('parseTmuxPaneContextOutput' in hostBrowserActions, false);
});
```

- [ ] **Step 2: Run host-browser tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: FAIL while the production file still exports the direct-tmux context
helpers.

- [ ] **Step 3: Remove direct tmux helpers from host-browser actions**

In `apps/mobile/src/lib/host-browser-actions.ts`, delete these exports:

```ts
export function buildHostBrowserPanePathCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{pane_current_path}'`;
}

export function buildHostBrowserPaneContextCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{pane_id}\t#{pane_tty}\t#{pane_current_path}'`;
}

export function buildTmuxCurrentWindowIdCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{window_id}'`;
}

export function parseTmuxPaneContextOutput(
	output: string,
): TmuxPaneContext | null {
	const lines = output
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean);

	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const [paneIdRaw, paneTtyRaw, ...panePathParts] =
			lines[index]?.split('\t') ?? [];
		const paneId = paneIdRaw?.trim() ?? '';
		const paneTty = paneTtyRaw?.trim() ?? '';
		const panePath = panePathParts.join('\t').trim();
		if (
			paneId.startsWith('%') &&
			paneTty.startsWith('/dev/') &&
			panePath
		) {
			return { paneId, paneTty, panePath };
		}
	}

	return null;
}
```

Keep `TmuxPaneContext`, `quoteShell`, `buildMdevOpenCommand`,
`buildTmuxWindowConfigGetCommand`, `buildTmuxWindowConfigSetCommand`, and
`buildHostBrowserStatusCycleCommand`.

- [ ] **Step 4: Resolve host browser context with `mdev tmux app context`**

In `apps/mobile/src/lib/shell-modals.tsx`, change the imports from
`@/lib/host-browser-actions` so they no longer import direct tmux helpers.
Add these imports:

```ts
import {
	buildWorkmuxAppContextCommand,
	formatWorkmuxAppCommandFailureMessage,
	parseWorkmuxAppContextOutput,
} from '@/lib/workmux-app-commands';
```

In `runHostBrowserCommand`, replace the failure block:

```ts
if (!result.success) {
	throw new Error(
		result.error || result.output || 'Remote command failed.',
	);
}
```

with:

```ts
if (!result.success) {
	const rawMessage = result.error || result.output || 'Remote command failed.';
	throw new Error(
		command.startsWith('mdev tmux app ')
			? formatWorkmuxAppCommandFailureMessage(rawMessage)
			: rawMessage,
	);
}
```

Replace `resolveHostBrowserPanePath` with:

```ts
const resolveHostBrowserPanePath = useCallback(async () => {
	if (!tmuxEnabled) {
		throw new Error(
			'Host browser actions require a Workmux-enabled connection.',
		);
	}
	const sessionName = tmuxTarget.trim() || 'main';
	const output = await runHostBrowserCommand(
		buildWorkmuxAppContextCommand(sessionName),
		10_000,
	);
	return parseWorkmuxAppContextOutput(output).panePath;
}, [runHostBrowserCommand, tmuxEnabled, tmuxTarget]);
```

Replace `resolveHostBrowserPaneContext` with:

```ts
const resolveHostBrowserPaneContext = useCallback(async () => {
	if (!tmuxEnabled) {
		throw new Error(
			'Host browser actions require a Workmux-enabled connection.',
		);
	}
	const sessionName = tmuxTarget.trim() || 'main';
	const output = await runHostBrowserCommand(
		buildWorkmuxAppContextCommand(sessionName),
		10_000,
	);
	const context = parseWorkmuxAppContextOutput(output);
	return {
		paneId: context.paneId,
		paneTty: context.paneTty,
		panePath: context.panePath,
	};
}, [runHostBrowserCommand, tmuxEnabled, tmuxTarget]);
```

- [ ] **Step 5: Run host-browser tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the command-boundary test again**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/workmux-app-commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/host-browser-actions.ts apps/mobile/src/lib/shell-modals.tsx apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "fix(mobile): resolve browser context through mdev app"
```

---

### Task 3: Move Agent Notification Routing And Ack To Workmux App Commands

**Files:**
- Modify: `apps/mobile/src/lib/agent-notification-visibility.ts`
- Modify: `apps/mobile/test/integration/agent-notification-visibility.test.ts`

- [ ] **Step 1: Update notification tests for app command output**

In `apps/mobile/test/integration/agent-notification-visibility.test.ts`, replace
the current visible-window acknowledgement command expectation with:

```ts
assert.deepEqual(harness.commands, [
	{
		command: "mdev tmux app window --session 'main'",
		timeoutMs: 10_000,
	},
]);
```

In the same test, change the fake command output from:

```ts
'ignored\n@12\n'
```

to:

```ts
'{"sessionName":"main","target":"main:@12","windowId":"@12","windowIndex":12,"windowName":"mobile","workspaceId":"workspace-1","role":"","roleWindow":false,"homeWindow":true}\n'
```

Replace every expected route command string:

```ts
"tmux select-window -t 'work:@12'"
"tmux select-window -t 'main:@12'"
```

with:

```ts
"mdev tmux app notification open --session 'work' --window-id '@12'"
"mdev tmux app notification open --session 'main' --window-id '@12'"
```

When a route test's fake `runCommand` returns an empty string for a successful
notification open, keep that behavior. `handleAgentNotificationRoute` does not
need to parse the returned context to acknowledge the route; it already knows
the authorized session and window id.

- [ ] **Step 2: Run notification tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/agent-notification-visibility.test.ts
```

Expected: FAIL because production still builds direct `tmux display-message` and
`tmux select-window` commands.

- [ ] **Step 3: Update notification command imports**

In `apps/mobile/src/lib/agent-notification-visibility.ts`, delete:

```ts
import { buildTmuxCurrentWindowIdCommand } from './host-browser-actions';
import { buildTmuxSelectWindowCommand } from './tmux-scrollback';
```

Add:

```ts
import {
	buildWorkmuxAppNotificationOpenCommand,
	buildWorkmuxAppWindowCommand,
	parseWorkmuxAppWindowOutput,
} from './workmux-app-commands';
```

- [ ] **Step 4: Route notification taps through mdev app**

In `handleAgentNotificationRoute`, replace:

```ts
await runCommand(
	buildTmuxSelectWindowCommand(session, agentWindowId),
	10_000,
);
```

with:

```ts
await runCommand(
	buildWorkmuxAppNotificationOpenCommand(session, agentWindowId),
	10_000,
);
```

- [ ] **Step 5: Acknowledge visible notifications through app window JSON**

In `acknowledgeVisibleAgentNotificationOnce`, replace:

```ts
const output = await runCommand(
	buildTmuxCurrentWindowIdCommand(sessionName),
	10_000,
);
const windowId = output
	.split(/\r?\n/)
	.map((line) => line.trim())
	.filter(Boolean)
	.at(-1);
```

with:

```ts
const output = await runCommand(
	buildWorkmuxAppWindowCommand(sessionName),
	10_000,
);
const windowId = parseWorkmuxAppWindowOutput(output).windowId;
```

Keep the existing visibility, request id, connection id, channel id, and
`tmuxTarget` stale-result checks unchanged.

- [ ] **Step 6: Run notification tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/agent-notification-visibility.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/agent-notification-visibility.ts apps/mobile/test/integration/agent-notification-visibility.test.ts
git commit -m "fix(mobile): route notifications through mdev app"
```

---

### Task 4: Move Touch Scrollback To Workmux App Scroll Commands

**Files:**
- Modify: `apps/mobile/src/lib/tmux-scrollback.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/test/integration/tmux-scrollback-batch.test.ts`
- Modify: `apps/mobile/test/integration/tmux-scrollback-cleanup.test.ts`
- Modify: `apps/mobile/test/integration/tmux-scrollback-executor.test.ts`

- [ ] **Step 1: Replace scrollback command-builder tests**

In the scrollback integration tests, remove imports for:

```ts
	buildTmuxScrollbackBatchCommand,
	buildTmuxScrollbackCopyModeCommand,
	buildTmuxSelectWindowCommand,
```

Add imports for:

```ts
	buildWorkmuxScrollbackBatchCommands,
	clearTmuxScrollbackLineAccumulator,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLiveInputCleanupBarrier,
	createTmuxScrollbackLineAccumulator,
	registerTmuxScrollbackLiveInputCleanup,
	resetTmuxScrollbackRuntimeStateForUiReset,
	TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH,
```

Replace the direct tmux command-builder tests at the top of the file with tests
for the final Workmux scrollback surface:

```ts
void test('buildWorkmuxScrollbackBatchCommands builds page scroll commands', () => {
	const pageStep = 24;

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'up',
			pages: 2,
			lines: 0,
			linesPerPage: pageStep,
			lineAccumulator: createTmuxScrollbackLineAccumulator(),
		}),
		["mdev tmux app scroll page-up --count '2' --session 'main'"],
	);
});

void test('buildWorkmuxScrollbackBatchCommands accumulates rows into receiver pages', () => {
	const lineAccumulator = createTmuxScrollbackLineAccumulator();
	const pageStep = 24;

	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		[],
	);
	assert.deepEqual(
		buildWorkmuxScrollbackBatchCommands({
			sessionName: 'main',
			direction: 'down',
			pages: 0,
			lines: 12,
			linesPerPage: pageStep,
			lineAccumulator,
		}),
		["mdev tmux app scroll page-down --count '1' --session 'main'"],
	);
});
```

Also cover direction resets, explicit accumulator clearing, page-command
splitting above `WORKMUX_APP_SCROLL_MAX_COUNT`, clamping at
`TMUX_SCROLLBACK_RECEIVER_MAX_PAGES_PER_BATCH`, executor serialization and
coalescing, failure cleanup, dispose cleanup, and shared cleanup-barrier waits
for live input, AppState transitions, and UI reset.

- [ ] **Step 2: Run scrollback tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/tmux-scrollback-batch.test.ts \
	test/integration/tmux-scrollback-cleanup.test.ts \
	test/integration/tmux-scrollback-executor.test.ts
```

Expected: FAIL because the new scrollback helper exports do not exist.

- [ ] **Step 3: Implement Workmux app scroll planning**

In `apps/mobile/src/lib/tmux-scrollback.ts`, delete `escapeTmuxTarget`,
`buildTmuxScrollbackCopyModeCommand`, `buildTmuxScrollbackBatchCommand`, and
`buildTmuxSelectWindowCommand`.

Add Workmux app scroll imports:

```ts
import {
	WORKMUX_APP_SCROLL_MAX_COUNT,
	buildWorkmuxAppScrollPageCommand,
	formatWorkmuxAppCommandFailureMessage,
	type WorkmuxScrollDirection,
} from './workmux-app-commands';
```

Add the final scrollback planning and execution helpers in
`apps/mobile/src/lib/tmux-scrollback.ts`:

```ts
export type TmuxScrollbackLineAccumulator = {
	direction: WorkmuxScrollDirection | null;
	lines: number;
};

export type WorkmuxScrollbackCommandExecutor = {
	runEnterCommand: (
		command: string,
		options?: { rollbackExitCommand?: string },
	) => Promise<boolean>;
	enqueueScrollBatch: (commands: string[]) => Promise<boolean>;
	reset: (options?: { exitCommand?: string; failurePolicy?: 'notify' | 'suppress' }) =>
		Promise<boolean> | null;
	dispose: (options?: { exitCommand?: string }) => Promise<boolean> | null;
};

export function createWorkmuxScrollbackCommandExecutor(...): WorkmuxScrollbackCommandExecutor;
export function createTmuxScrollbackLineAccumulator(): TmuxScrollbackLineAccumulator;
export function clearTmuxScrollbackLineAccumulator(...): void;
export function resetTmuxScrollbackRuntimeState(...): Promise<boolean> | null;
export function resetTmuxScrollbackRuntimeStateForUiReset(...): Promise<boolean> | null;
export function createTmuxScrollbackLiveInputCleanupBarrier(...);
export function registerTmuxScrollbackLiveInputCleanup(...): Promise<boolean> | null;
export function registerTmuxScrollbackRemoteCopyModeExitCleanup(...): Promise<boolean> | null;

export function buildWorkmuxScrollbackBatchCommands({
	sessionName,
	direction,
	pages,
	lines,
	lineAccumulator,
	linesPerPage,
}: {
	sessionName: string;
	direction: 'up' | 'down';
	pages: number;
	lines: number;
	lineAccumulator: TmuxScrollbackLineAccumulator;
	linesPerPage: number;
}): string[] {
	// Accumulate sub-page receiver line batches using the bridge-supplied
	// `pageStep`, clamp malformed batches, and split large requests into
	// Workmux app page commands bounded by `WORKMUX_APP_SCROLL_MAX_COUNT`.
}
```

The executor must run all `mdev tmux app scroll ...` commands through the SSH
side-channel command function supplied by the shell detail screen. It should
serialize `scroll enter`, scroll pages, reset exits, and dispose exits; coalesce
pending scroll batches while a slow command is in flight; and route active
failures to the Workmux scrollback failure alert while suppressing dispose-only
failure alerts.

- [ ] **Step 4: Update shell detail scrollback handlers**

In `apps/mobile/src/app/shell/detail.tsx`, replace imports of
`buildTmuxScrollbackBatchCommand` and `buildTmuxScrollbackCopyModeCommand` with:

```ts
	buildWorkmuxScrollbackBatchCommands,
	createTmuxScrollbackLiveInputCleanupBarrier,
	createWorkmuxScrollbackCommandExecutor,
	createTmuxScrollbackLineAccumulator,
	handleTmuxScrollbackInactiveAppStateTransition,
	handleWorkmuxScrollbackCommandFailureActions,
	registerTmuxScrollbackRemoteCopyModeExitCleanup,
	resetTmuxScrollbackRuntimeStateForUiReset,
```

from `@/lib/tmux-scrollback`, and import:

```ts
import {
	buildWorkmuxAppScrollEnterCommand,
	buildWorkmuxAppScrollExitCommand,
} from '@/lib/workmux-app-commands';
```

Add a ref near the other scrollback refs:

```ts
const tmuxScrollbackLineAccumulatorRef = useRef(
	createTmuxScrollbackLineAccumulator(),
);
const scrollbackCleanupBarrierRef = useRef(
	createTmuxScrollbackLiveInputCleanupBarrier(),
);
```

Create `workmuxScrollbackCommandExecutor` with `executeSideChannelCommand`:

```ts
const workmuxScrollbackCommandExecutor = useMemo(
	() =>
		createWorkmuxScrollbackCommandExecutor({
			executeCommand: (command) =>
				executeSideChannelCommand(
					connection,
					command,
					WORKMUX_SCROLLBACK_COMMAND_TIMEOUT_MS,
				),
			onFailure: handleWorkmuxScrollbackCommandFailure,
			onDisposeExitFailure: (message) =>
				logger.warn(`Workmux scrollback dispose exit failed: ${message}`),
		}),
	[connection, handleWorkmuxScrollbackCommandFailure],
);
```

Use `resetTmuxScrollbackRuntimeStateForUiReset` for scrollback mode exits,
AppState inactive transitions, alert cleanup, and component disposal. Register
each remote copy-mode exit promise on the cleanup barrier so live input waits for
the same pending Workmux app exit instead of racing it.

In `handleScrollbackEnterRequested`, replace command construction with:

```ts
const targetName = tmuxTarget.trim().length ? tmuxTarget.trim() : 'main';
const command = buildWorkmuxAppScrollEnterCommand(targetName);
```

Use `buildWorkmuxAppScrollExitCommand(targetName)` for touch scrollback cleanup
and rollback after a successful `scroll enter`.

```text
mdev tmux app scroll exit --session <session>
```

In `handleTmuxScrollBatch`, replace the current single command construction with:

```ts
const targetName = tmuxTarget.trim().length ? tmuxTarget.trim() : 'main';
const commands = buildWorkmuxScrollbackBatchCommands({
	sessionName: targetName,
	direction: event.direction,
	pages: event.pages,
	lines: event.lines,
	linesPerPage: event.pageStep,
	lineAccumulator: tmuxScrollbackLineAccumulatorRef.current,
});
if (commands.length === 0) return;
void workmuxScrollbackCommandExecutor.enqueueScrollBatch(commands);
```

Keep the existing guards for shell presence, instance id, selection mode,
`tmuxEnabled`, connection presence, active scrollback state, and current
instance id. Enqueue touch-scroll commands through the shared Workmux scrollback
executor so page batches, cleanup exits, live-input waits, and failure handling
share one side-channel path.

- [ ] **Step 5: Run scrollback tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/tmux-scrollback-batch.test.ts \
	test/integration/tmux-scrollback-cleanup.test.ts \
	test/integration/tmux-scrollback-executor.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/tmux-scrollback.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/tmux-scrollback-batch.test.ts apps/mobile/test/integration/tmux-scrollback-cleanup.test.ts apps/mobile/test/integration/tmux-scrollback-executor.test.ts
git commit -m "fix(mobile): drive scrollback through mdev app"
```

---

### Task 5: Add Workmux Keyboard App Actions

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Add failing keyboard action tests**

Append this test to `apps/mobile/test/integration/keyboard-actions.test.ts`:

```ts
void test('Workmux keyboard actions delegate semantic commands without sending bytes', async () => {
	const commands: unknown[] = [];
	let sentBytes = 0;

	const context = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {
			sentBytes += 1;
		},
		pasteClipboard: async () => {},
		copySelection: () => {},
		runWorkmuxKeyboardCommand: (command: unknown) => {
			commands.push(command);
		},
	} as Parameters<typeof runAction>[1];

	await runAction('WORKMUX_FOCUS_CLAUDE', context);
	await runAction('WORKMUX_FOCUS_PREV', context);
	await runAction('WORKMUX_NAV_NEXT', context);
	await runAction('WORKMUX_NAV_PREV_ALL', context);

	assert.deepEqual(commands, [
		{ type: 'focus', target: 'claude' },
		{ type: 'focus', target: 'prev' },
		{ type: 'nav', action: 'next' },
		{ type: 'nav', action: 'prev-all' },
	]);
	assert.equal(sentBytes, 0);
	assert.equal(KNOWN_ACTION_IDS.includes('WORKMUX_FOCUS_CLAUDE'), true);
	assert.equal(KNOWN_ACTION_IDS.includes('WORKMUX_NAV_NEXT'), true);
});
```

- [ ] **Step 2: Run keyboard action tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: FAIL because Workmux action ids and `runWorkmuxKeyboardCommand` do
not exist.

- [ ] **Step 3: Add Workmux keyboard action types**

In `apps/mobile/src/lib/keyboard-actions.ts`, add imports:

```ts
import {
	type WorkmuxFocusTarget,
	type WorkmuxNavAction,
} from '@/lib/workmux-app-commands';
```

Add these action ids to `KNOWN_ACTION_IDS` before `CYCLE_WORKMUX_STATUS`:

```ts
	'WORKMUX_FOCUS_CLAUDE',
	'WORKMUX_FOCUS_GIT',
	'WORKMUX_FOCUS_CODEX',
	'WORKMUX_FOCUS_BASH',
	'WORKMUX_FOCUS_PREV',
	'WORKMUX_FOCUS_NEXT',
	'WORKMUX_FOCUS_TOGGLE_GIT_BASH',
	'WORKMUX_NAV_PREV',
	'WORKMUX_NAV_NEXT',
	'WORKMUX_NAV_PREV_ALL',
	'WORKMUX_NAV_NEXT_ALL',
```

Add this exported type:

```ts
export type WorkmuxKeyboardCommand =
	| { type: 'focus'; target: WorkmuxFocusTarget }
	| { type: 'nav'; action: WorkmuxNavAction; index?: number };
```

Add this optional property to `ActionContext`:

```ts
	runWorkmuxKeyboardCommand?: (command: WorkmuxKeyboardCommand) => void;
```

- [ ] **Step 4: Route Workmux action ids to semantic commands**

In `runAction`, add these cases before `CYCLE_WORKMUX_STATUS`:

```ts
		case 'WORKMUX_FOCUS_CLAUDE': {
			context.runWorkmuxKeyboardCommand?.({ type: 'focus', target: 'claude' });
			return;
		}
		case 'WORKMUX_FOCUS_GIT': {
			context.runWorkmuxKeyboardCommand?.({ type: 'focus', target: 'git' });
			return;
		}
		case 'WORKMUX_FOCUS_CODEX': {
			context.runWorkmuxKeyboardCommand?.({ type: 'focus', target: 'codex' });
			return;
		}
		case 'WORKMUX_FOCUS_BASH': {
			context.runWorkmuxKeyboardCommand?.({ type: 'focus', target: 'bash' });
			return;
		}
		case 'WORKMUX_FOCUS_PREV': {
			context.runWorkmuxKeyboardCommand?.({ type: 'focus', target: 'prev' });
			return;
		}
		case 'WORKMUX_FOCUS_NEXT': {
			context.runWorkmuxKeyboardCommand?.({ type: 'focus', target: 'next' });
			return;
		}
		case 'WORKMUX_FOCUS_TOGGLE_GIT_BASH': {
			context.runWorkmuxKeyboardCommand?.({
				type: 'focus',
				target: 'toggle-git-bash',
			});
			return;
		}
		case 'WORKMUX_NAV_PREV': {
			context.runWorkmuxKeyboardCommand?.({ type: 'nav', action: 'prev' });
			return;
		}
		case 'WORKMUX_NAV_NEXT': {
			context.runWorkmuxKeyboardCommand?.({ type: 'nav', action: 'next' });
			return;
		}
		case 'WORKMUX_NAV_PREV_ALL': {
			context.runWorkmuxKeyboardCommand?.({ type: 'nav', action: 'prev-all' });
			return;
		}
		case 'WORKMUX_NAV_NEXT_ALL': {
			context.runWorkmuxKeyboardCommand?.({ type: 'nav', action: 'next-all' });
			return;
		}
```

- [ ] **Step 5: Wire keyboard Workmux commands to the side-channel**

In `apps/mobile/src/app/shell/detail.tsx`, import:

```ts
import {
	WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
	buildWorkmuxAppFocusCommand,
	buildWorkmuxAppNavCommand,
	formatWorkmuxAppCommandFailureMessage,
	type WorkmuxFocusTarget,
	type WorkmuxNavAction,
} from '@/lib/workmux-app-commands';
import { type WorkmuxKeyboardCommand } from '@/lib/keyboard-actions';
```

Add this callback before `actionContext`:

```ts
const runWorkmuxKeyboardCommand = useCallback(
	(command: WorkmuxKeyboardCommand) => {
		void (async () => {
			try {
				if (!tmuxEnabled) {
					throw new Error('Workmux actions require a Workmux-enabled connection.');
				}
				const sessionName = tmuxTarget.trim() || 'main';
				const remoteCommand =
					command.type === 'focus'
						? buildWorkmuxAppFocusCommand(
								sessionName,
								command.target as WorkmuxFocusTarget,
							)
						: buildWorkmuxAppNavCommand(
								sessionName,
								command.action as WorkmuxNavAction,
								command.index,
							);
				await browserActions.runHostBrowserCommand(remoteCommand, 10_000);
			} catch (error) {
				const message = formatWorkmuxAppCommandFailureMessage(
					getErrorMessage(error),
				);
				Alert.alert(
					'Workmux action failed',
					message || WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
				);
			}
		})();
	},
	[
		browserActions,
		getErrorMessage,
		tmuxEnabled,
		tmuxTarget,
	],
);
```

Add this property to the `actionContext` object:

```ts
runWorkmuxKeyboardCommand,
```

Add `runWorkmuxKeyboardCommand` to the `useMemo` dependency list.

- [ ] **Step 6: Run keyboard action tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/keyboard-actions.test.ts
git commit -m "feat(mobile): add Workmux keyboard app actions"
```

---

### Task 6: Update Runtime Keyboard Config To Use Workmux Actions

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Update keyboard config test expectations**

In `apps/mobile/test/integration/keyboard-config.test.ts`, replace the `Role`
slot expectation inside
`phone base keyboard exposes role and workspace navigation controls` with:

```ts
assert.deepEqual(phoneBaseKeyboard.grid[0]?.[5], {
	type: 'action',
	actionId: 'WORKMUX_FOCUS_NEXT',
	label: 'Role',
	icon: 'SquareSplitVertical',
	longPress: {
		options: [
			{
				type: 'action',
				actionId: 'WORKMUX_FOCUS_NEXT',
				label: 'Next role',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_FOCUS_PREV',
				label: 'Prev role',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_FOCUS_CLAUDE',
				label: 'Claude',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_FOCUS_GIT',
				label: 'Git',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_FOCUS_CODEX',
				label: 'Codex',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_FOCUS_BASH',
				label: 'Bash',
				icon: null,
			},
		],
	},
});
```

Replace the `Work` slot expectation with:

```ts
assert.deepEqual(phoneBaseKeyboard.grid[0]?.[6], {
	type: 'action',
	actionId: 'WORKMUX_NAV_NEXT',
	label: 'Work',
	icon: 'AppWindow',
	span: 2,
	longPress: {
		options: [
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_NEXT',
				label: 'Next work',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_PREV',
				label: 'Prev work',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_NEXT_ALL',
				label: 'Next all',
				icon: null,
			},
			{
				type: 'action',
				actionId: 'WORKMUX_NAV_PREV_ALL',
				label: 'Prev all',
				icon: null,
			},
		],
	},
});
```

Replace the long-press `Prev all` option on `secondRow[0]` with an action:

```ts
{
	type: 'action',
	actionId: 'WORKMUX_NAV_PREV_ALL',
	label: 'Prev all',
	icon: null,
}
```

Replace the long-press `Next all` option on `secondRow[1]` with an action:

```ts
{
	type: 'action',
	actionId: 'WORKMUX_NAV_NEXT_ALL',
	label: 'Next all',
	icon: null,
}
```

- [ ] **Step 2: Run keyboard config tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: FAIL because `shell-config.json` still uses byte slots for those
Workmux controls.

- [ ] **Step 3: Update `shell-config.json` role and workspace slots**

In `apps/mobile/config/shell-config.json`, update the phone base `Role` slot to:

```json
{
	"type": "action",
	"actionId": "WORKMUX_FOCUS_NEXT",
	"label": "Role",
	"icon": "SquareSplitVertical",
	"longPress": {
		"options": [
			{
				"type": "action",
				"actionId": "WORKMUX_FOCUS_NEXT",
				"label": "Next role",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_FOCUS_PREV",
				"label": "Prev role",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_FOCUS_CLAUDE",
				"label": "Claude",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_FOCUS_GIT",
				"label": "Git",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_FOCUS_CODEX",
				"label": "Codex",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_FOCUS_BASH",
				"label": "Bash",
				"icon": null
			}
		]
	}
}
```

Update the phone base `Work` slot to:

```json
{
	"type": "action",
	"actionId": "WORKMUX_NAV_NEXT",
	"label": "Work",
	"icon": "AppWindow",
	"span": 2,
	"longPress": {
		"options": [
			{
				"type": "action",
				"actionId": "WORKMUX_NAV_NEXT",
				"label": "Next work",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_NAV_PREV",
				"label": "Prev work",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_NAV_NEXT_ALL",
				"label": "Next all",
				"icon": null
			},
			{
				"type": "action",
				"actionId": "WORKMUX_NAV_PREV_ALL",
				"label": "Prev all",
				"icon": null
			}
		]
	}
}
```

In the `ARROW_LEFT` long-press options, replace the `Prev all` byte option with:

```json
{
	"type": "action",
	"actionId": "WORKMUX_NAV_PREV_ALL",
	"label": "Prev all",
	"icon": null
}
```

In the `ARROW_RIGHT` long-press options, replace the `Next all` byte option with:

```json
{
	"type": "action",
	"actionId": "WORKMUX_NAV_NEXT_ALL",
	"label": "Next all",
	"icon": null
}
```

Keep plain arrow keys, page keys, status cycle, and the `Hide` long-press byte
unchanged because this plan only migrates behavior covered by the merged
`mdev tmux app` command surface.

- [ ] **Step 4: Run keyboard config tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "chore(mobile): use Workmux app keyboard actions"
```

---

### Task 7: Make The Direct Tmux Guard Zero Tolerance

**Files:**
- Modify: `apps/mobile/test/integration/direct-tmux-boundary.test.ts`

- [ ] **Step 1: Update the guard expectation**

In `apps/mobile/test/integration/direct-tmux-boundary.test.ts`, remove the
temporary allowlist and compare the scanner output directly to an empty list:

```ts
assert.deepEqual(
	[...actualOccurrencesByFile.entries()].sort(),
	[],
	JSON.stringify([...actualOccurrencesByFile.entries()]),
);
```

Do not change the scanner. The test should still scan:

```ts
const scannedRoots = [
	path.join(repoRoot, 'apps/mobile/src'),
	path.join(
		repoRoot,
		'packages/react-native-uniffi-russh/rust/uniffi-russh/src',
	),
];
```

- [ ] **Step 2: Run the guard to verify it fails if direct tmux remains**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/direct-tmux-boundary.test.ts
```

Expected: FAIL if any direct `tmux ...` command strings remain in scanned app or
runtime Rust source. Expected: PASS after Tasks 2 through 6 have removed the
temporary direct-tmux helpers.

- [ ] **Step 3: Remove any remaining app source direct-tmux command strings**

Run this scan:

```bash
rg -n "tmux (display-message|copy-mode|send-keys|select-window|capture-pane|list-panes|attach)" apps/mobile/src packages/react-native-uniffi-russh/rust/uniffi-russh/src -S
```

Expected: no output. If it reports a shell command string, stop and replace that
specific command with a builder from
`apps/mobile/src/lib/workmux-app-commands.ts` before continuing. Do not remove
prose-only user messages such as `tmux attach failed`; the guard already
classifies those as non-shell prose.

- [ ] **Step 4: Run the guard to verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/direct-tmux-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src packages/react-native-uniffi-russh/rust/uniffi-russh/src apps/mobile/test/integration/direct-tmux-boundary.test.ts
git commit -m "test(mobile): reject direct Workmux tmux commands"
```

---

### Task 8: Focused Verification

**Files:**
- No file edits unless verification exposes a defect.

- [ ] **Step 1: Run the focused mobile integration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
	test/integration/workmux-app-commands.test.ts \
	test/integration/host-browser-actions.test.ts \
	test/integration/tmux-scrollback-batch.test.ts \
	test/integration/tmux-scrollback-cleanup.test.ts \
	test/integration/tmux-scrollback-executor.test.ts \
	test/integration/agent-notification-visibility.test.ts \
	test/integration/keyboard-actions.test.ts \
	test/integration/keyboard-config.test.ts \
	test/integration/direct-tmux-boundary.test.ts
```

Expected: PASS for all listed tests.

- [ ] **Step 2: Run mobile typecheck if focused tests pass**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint check if typecheck passes**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS.

- [ ] **Step 4: Check final source references**

Run:

```bash
rg -n "buildTmuxScrollback|buildTmuxSelectWindow|buildTmuxCurrentWindowId|buildHostBrowserPane(Context|Path)Command|parseTmuxPaneContextOutput" apps/mobile/src apps/mobile/test -S
```

Expected: no output.

- [ ] **Step 5: Commit verification-only fixes if any were needed**

If Steps 1 through 4 required code fixes, commit the fixed files:

```bash
git add apps/mobile/src apps/mobile/test apps/mobile/config/shell-config.json
git commit -m "fix(mobile): complete Workmux app boundary cleanup"
```

If no fixes were needed, do not create an empty commit.

---

## Rollout Note

Before testing this in the Android app against a real Workmux session, update
the remote `mdev` installation so it includes merged PR 93 and the later
`mdev tmux app scroll exit --session <session>` command added in local `mdev`
commit `39b6b1d`. Older remotes are intentionally unsupported for the migrated
Workmux actions and should fail with the update message instead of falling back
to direct tmux.
