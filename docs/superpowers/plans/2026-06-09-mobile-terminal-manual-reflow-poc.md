# Mobile Terminal Manual Reflow POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manual `Reflow terminal` command that captures the active Workmux pane, locally wraps recent text to the mobile terminal width, rebuilds the mobile xterm view, and leaves the shared tmux window size untouched.

**Architecture:** Add a focused terminal reflow module for pure formatting and tmux capture command construction, then add a testable runner that coordinates pane resolution, side-channel capture, xterm clear/write, and live-output buffering. Wire the runner into the existing shell detail action dispatcher through a new `REFLOW_TERMINAL` native action and expose it in the existing `Cmds > mdev` menu.

**Tech Stack:** Expo React Native, TypeScript, xterm.js WebView handle, existing Workmux context helpers, existing SSH side-channel command runner, Node test runner via `tsx --test`.

---

## File Structure

- Create `apps/mobile/src/lib/terminal-reflow.ts`
  - Owns pure text formatting and tmux capture command construction.
  - Exports `formatTerminalReflowSnapshot`, `buildTmuxCapturePaneCommand`, and constants.
- Create `apps/mobile/src/lib/terminal-reflow-runner.ts`
  - Owns POC orchestration behind dependency injection so behavior is testable without rendering React Native.
  - Uses the pure module to build the command and format captured text.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Adds `REFLOW_TERMINAL` to known/supported action ids.
  - Adds `reflowTerminal?: () => Promise<void> | void` to `ActionContext`.
  - Dispatches the new action.
- Modify `apps/mobile/config/shell-config.json`
  - Bumps runtime config version/date.
  - Adds `Reflow terminal` under `Cmds > mdev`.
- Modify `apps/mobile/src/lib/shell-modals.tsx`
  - Exposes the already-existing `resolveHostBrowserPaneContext` callback from `useBrowserActionsController`.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Tracks latest terminal size.
  - Buffers live terminal chunks during manual reflow.
  - Wires `REFLOW_TERMINAL` to `createManualTerminalReflowRunner`.
- Create `apps/mobile/test/integration/terminal-reflow.test.ts`
  - Tests formatting and capture command construction.
- Create `apps/mobile/test/integration/terminal-reflow-runner.test.ts`
  - Tests runner success, local precondition failures, remote failure, and live-buffer flushing.
- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Tests `REFLOW_TERMINAL` is supported and dispatches to context.
- Modify `apps/mobile/test/integration/keyboard-config.test.ts`
  - Tests bundled command menu exposes `Reflow terminal`.
- Modify `apps/mobile/test/integration/shell-config-schema.test.ts`
  - Tests runtime config accepts `REFLOW_TERMINAL` command action entries.

### Task 1: Pure Reflow Formatter And Capture Command

**Files:**
- Create: `apps/mobile/src/lib/terminal-reflow.ts`
- Create: `apps/mobile/test/integration/terminal-reflow.test.ts`

- [ ] **Step 1: Write the failing formatter and command tests**

Create `apps/mobile/test/integration/terminal-reflow.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MIN_TERMINAL_REFLOW_COLS,
	TERMINAL_REFLOW_HISTORY_LINES,
	buildTmuxCapturePaneCommand,
	formatTerminalReflowSnapshot,
	normalizeTerminalReflowCols,
} from '../../src/lib/terminal-reflow';

const decoder = new TextDecoder();

function decode(bytes: Uint8Array): string {
	return decoder.decode(bytes);
}

void test('formatTerminalReflowSnapshot wraps long lines to the current cols', () => {
	const bytes = formatTerminalReflowSnapshot(
		'START:abcdefghijklmnopqrstuvwxyz:END',
		12,
	);

	assert.equal(
		decode(bytes),
		[
			'START:abcdef',
			'ghijklmnopqr',
			'stuvwxyz:END',
			'',
		].join('\r\n'),
	);
});

void test('formatTerminalReflowSnapshot preserves explicit newlines and normalizes CRLF', () => {
	const bytes = formatTerminalReflowSnapshot('alpha\r\nbeta\ngamma', 80);

	assert.equal(decode(bytes), ['alpha', 'beta', 'gamma', ''].join('\r\n'));
});

void test('formatTerminalReflowSnapshot trims trailing empty viewport filler', () => {
	const bytes = formatTerminalReflowSnapshot('alpha\n\n\n', 80);

	assert.equal(decode(bytes), ['alpha', ''].join('\r\n'));
});

void test('formatTerminalReflowSnapshot returns empty bytes for empty captures', () => {
	const bytes = formatTerminalReflowSnapshot('\n\n   \n', 80);

	assert.equal(bytes.length, 0);
});

void test('normalizeTerminalReflowCols applies a defensive minimum', () => {
	assert.equal(normalizeTerminalReflowCols(0), MIN_TERMINAL_REFLOW_COLS);
	assert.equal(normalizeTerminalReflowCols(1), MIN_TERMINAL_REFLOW_COLS);
	assert.equal(normalizeTerminalReflowCols(19), MIN_TERMINAL_REFLOW_COLS);
	assert.equal(normalizeTerminalReflowCols(20), 20);
	assert.equal(normalizeTerminalReflowCols(64), 64);
});

void test('buildTmuxCapturePaneCommand captures joined recent pane text', () => {
	assert.equal(
		buildTmuxCapturePaneCommand({ paneId: '%34' }),
		`tmux capture-pane -J -p -t '%34' -S -${TERMINAL_REFLOW_HISTORY_LINES} -E -`,
	);
});

void test('buildTmuxCapturePaneCommand shell-quotes pane targets', () => {
	assert.equal(
		buildTmuxCapturePaneCommand({ paneId: "%pane'quoted", historyLines: 12 }),
		"tmux capture-pane -J -p -t '%pane'\\''quoted' -S -12 -E -",
	);
});

void test('buildTmuxCapturePaneCommand rejects unsafe pane targets and ranges', () => {
	assert.throws(
		() => buildTmuxCapturePaneCommand({ paneId: '' }),
		/Missing tmux pane id/,
	);
	assert.throws(
		() => buildTmuxCapturePaneCommand({ paneId: '%1\nrm -rf /' }),
		/Invalid tmux pane id/,
	);
	assert.throws(
		() => buildTmuxCapturePaneCommand({ paneId: '%1', historyLines: 0 }),
		/Invalid terminal reflow history line count/,
	);
	assert.throws(
		() =>
			buildTmuxCapturePaneCommand({
				paneId: '%1',
				historyLines: 10_001,
			}),
		/Invalid terminal reflow history line count/,
	);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/terminal-reflow.test.ts
```

Expected: FAIL with an import error like:

```text
Cannot find module '../../src/lib/terminal-reflow'
```

- [ ] **Step 3: Implement the pure reflow module**

Create `apps/mobile/src/lib/terminal-reflow.ts`:

```ts
export const TERMINAL_REFLOW_HISTORY_LINES = 300;
export const MIN_TERMINAL_REFLOW_COLS = 20;
const MAX_TERMINAL_REFLOW_HISTORY_LINES = 10_000;

const encoder = new TextEncoder();

export function normalizeTerminalReflowCols(cols: number): number {
	if (!Number.isSafeInteger(cols) || cols < MIN_TERMINAL_REFLOW_COLS) {
		return MIN_TERMINAL_REFLOW_COLS;
	}
	return cols;
}

export function formatTerminalReflowSnapshot(
	capturedText: string,
	cols: number,
): Uint8Array {
	const width = normalizeTerminalReflowCols(cols);
	const normalizedText = capturedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const lines = normalizedText.split('\n');

	while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
		lines.pop();
	}

	if (lines.length === 0) return new Uint8Array();

	const wrappedLines = lines.flatMap((line) => wrapLine(line, width));
	return encoder.encode(`${wrappedLines.join('\r\n')}\r\n`);
}

function wrapLine(line: string, width: number): string[] {
	if (line.length === 0) return [''];
	const wrapped: string[] = [];
	for (let offset = 0; offset < line.length; offset += width) {
		wrapped.push(line.slice(offset, offset + width));
	}
	return wrapped;
}

export function buildTmuxCapturePaneCommand({
	paneId,
	historyLines = TERMINAL_REFLOW_HISTORY_LINES,
}: {
	paneId: string;
	historyLines?: number;
}): string {
	const target = paneId.trim();
	if (!target) throw new Error('Missing tmux pane id.');
	if (/[\r\n]/.test(target)) throw new Error('Invalid tmux pane id.');
	if (
		!Number.isSafeInteger(historyLines) ||
		historyLines <= 0 ||
		historyLines > MAX_TERMINAL_REFLOW_HISTORY_LINES
	) {
		throw new Error('Invalid terminal reflow history line count.');
	}

	return [
		'tmux capture-pane',
		'-J',
		'-p',
		`-t ${quoteShellValue(target)}`,
		`-S -${historyLines}`,
		'-E -',
	].join(' ');
}

function quoteShellValue(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
```

- [ ] **Step 4: Run the formatter tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/terminal-reflow.test.ts
```

Expected: PASS. The output should include:

```text
# pass
```

- [ ] **Step 5: Commit the pure reflow module**

Run:

```bash
git add apps/mobile/src/lib/terminal-reflow.ts apps/mobile/test/integration/terminal-reflow.test.ts
git commit -m "feat(mobile): add terminal reflow formatter"
```

### Task 2: Testable Manual Reflow Runner

**Files:**
- Create: `apps/mobile/src/lib/terminal-reflow-runner.ts`
- Create: `apps/mobile/test/integration/terminal-reflow-runner.test.ts`

- [ ] **Step 1: Write the failing runner tests**

Create `apps/mobile/test/integration/terminal-reflow-runner.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createManualTerminalReflowRunner,
	type ManualTerminalReflowDeps,
} from '../../src/lib/terminal-reflow-runner';

const decoder = new TextDecoder();

type FakeConnection = { id: string };

function createDeps(
	overrides: Partial<ManualTerminalReflowDeps<FakeConnection>> = {},
): ManualTerminalReflowDeps<FakeConnection> & {
	writes: string[];
	failures: { title: string; message: string }[];
	buffered: Uint8Array[];
	commands: string[];
} {
	const writes: string[] = [];
	const failures: { title: string; message: string }[] = [];
	const buffered = [new TextEncoder().encode('LIVE\r\n')];
	const commands: string[] = [];
	const deps: ManualTerminalReflowDeps<FakeConnection> & {
		writes: string[];
		failures: { title: string; message: string }[];
		buffered: Uint8Array[];
		commands: string[];
	} = {
		getConnection: () => ({ id: 'conn-1' }),
		isTmuxEnabled: () => true,
		getTerminalSize: () => ({ cols: 12, rows: 24 }),
		getXterm: () => ({
			clear: () => writes.push('__clear__'),
			write: (bytes) => writes.push(decoder.decode(bytes)),
			flush: () => writes.push('__flush__'),
			fit: () => writes.push('__fit__'),
		}),
		resolvePaneContext: async () => ({
			paneId: '%34',
			paneTty: '/dev/pts/1',
			panePath: '/home/muly/fressh',
		}),
		executeSideChannelCommand: async (_connection, command) => {
			commands.push(command);
			return {
				success: true,
				output: 'START:abcdefghijklmnopqrstuvwxyz:END',
			};
		},
		beginLiveBuffer: () => {
			writes.push('__begin_buffer__');
		},
		endLiveBuffer: () => {
			writes.push('__end_buffer__');
			return buffered;
		},
		showFailure: (title, message) => {
			failures.push({ title, message });
		},
		getErrorMessage: (error) =>
			error instanceof Error ? error.message : String(error),
		writes,
		failures,
		buffered,
		commands,
		...overrides,
	};
	return deps;
}

void test('manual terminal reflow captures, rebuilds, and flushes buffered live chunks', async () => {
	const deps = createDeps();
	const runner = createManualTerminalReflowRunner(deps);

	await runner.run();

	assert.deepEqual(deps.commands, [
		"tmux capture-pane -J -p -t '%34' -S -300 -E -",
	]);
	assert.deepEqual(deps.failures, []);
	assert.deepEqual(deps.writes, [
		'__begin_buffer__',
		'__end_buffer__',
		'__clear__',
		['START:abcdef', 'ghijklmnopqr', 'stuvwxyz:END', ''].join('\r\n'),
		'__flush__',
		'LIVE\r\n',
		'__flush__',
	]);
});

void test('manual terminal reflow keeps current view unchanged when terminal size is missing', async () => {
	const deps = createDeps({
		getTerminalSize: () => null,
	});
	const runner = createManualTerminalReflowRunner(deps);

	await runner.run();

	assert.deepEqual(deps.commands, []);
	assert.deepEqual(deps.writes, ['__fit__']);
	assert.deepEqual(deps.failures, [
		{
			title: 'Reflow terminal',
			message: 'Terminal size is not ready yet. Try again.',
		},
	]);
});

void test('manual terminal reflow reports missing connection without clearing xterm', async () => {
	const deps = createDeps({
		getConnection: () => null,
	});
	const runner = createManualTerminalReflowRunner(deps);

	await runner.run();

	assert.deepEqual(deps.commands, []);
	assert.deepEqual(deps.writes, []);
	assert.deepEqual(deps.failures, [
		{
			title: 'Reflow terminal failed',
			message: 'No SSH connection available.',
		},
	]);
});

void test('manual terminal reflow reports non-Workmux sessions without clearing xterm', async () => {
	const deps = createDeps({
		isTmuxEnabled: () => false,
	});
	const runner = createManualTerminalReflowRunner(deps);

	await runner.run();

	assert.deepEqual(deps.commands, []);
	assert.deepEqual(deps.writes, []);
	assert.deepEqual(deps.failures, [
		{
			title: 'Reflow terminal failed',
			message: 'Reflow requires a Workmux session.',
		},
	]);
});

void test('manual terminal reflow flushes buffered live chunks and preserves current view on capture failure', async () => {
	const deps = createDeps({
		executeSideChannelCommand: async () => ({
			success: false,
			output: '',
			error: 'capture failed',
		}),
	});
	const runner = createManualTerminalReflowRunner(deps);

	await runner.run();

	assert.deepEqual(deps.writes, [
		'__begin_buffer__',
		'__end_buffer__',
		'LIVE\r\n',
		'__flush__',
	]);
	assert.deepEqual(deps.failures, [
		{
			title: 'Reflow terminal failed',
			message: 'capture failed',
		},
	]);
});

void test('manual terminal reflow treats empty capture as a failure without clearing xterm', async () => {
	const deps = createDeps({
		executeSideChannelCommand: async () => ({
			success: true,
			output: '\n\n',
		}),
	});
	const runner = createManualTerminalReflowRunner(deps);

	await runner.run();

	assert.deepEqual(deps.writes, [
		'__begin_buffer__',
		'__end_buffer__',
		'LIVE\r\n',
		'__flush__',
	]);
	assert.deepEqual(deps.failures, [
		{
			title: 'Reflow terminal failed',
			message: 'No pane content was captured.',
		},
	]);
});
```

- [ ] **Step 2: Run the new runner test to verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/terminal-reflow-runner.test.ts
```

Expected: FAIL with an import error like:

```text
Cannot find module '../../src/lib/terminal-reflow-runner'
```

- [ ] **Step 3: Implement the runner**

Create `apps/mobile/src/lib/terminal-reflow-runner.ts`:

```ts
import {
	buildTmuxCapturePaneCommand,
	formatTerminalReflowSnapshot,
} from './terminal-reflow';

export type TerminalReflowPaneContext = {
	paneId: string;
	paneTty: string;
	panePath: string;
};

export type TerminalReflowSize = {
	cols: number;
	rows: number;
};

export type TerminalReflowXterm = {
	clear: () => void;
	write: (bytes: Uint8Array) => void;
	flush: () => void;
	fit: () => void;
};

export type TerminalReflowCommandResult = {
	success: boolean;
	output: string;
	error?: string;
};

export type ManualTerminalReflowDeps<TConnection> = {
	getConnection: () => TConnection | null;
	isTmuxEnabled: () => boolean;
	getTerminalSize: () => TerminalReflowSize | null;
	getXterm: () => TerminalReflowXterm | null;
	resolvePaneContext: () => Promise<TerminalReflowPaneContext>;
	executeSideChannelCommand: (
		connection: TConnection,
		command: string,
		timeoutMs: number,
	) => Promise<TerminalReflowCommandResult>;
	beginLiveBuffer: () => void;
	endLiveBuffer: () => Uint8Array[];
	showFailure: (title: string, message: string) => void;
	getErrorMessage: (error: unknown) => string;
};

export type ManualTerminalReflowRunner = {
	run: () => Promise<void>;
};

const TERMINAL_REFLOW_TIMEOUT_MS = 10_000;

export function createManualTerminalReflowRunner<TConnection>(
	deps: ManualTerminalReflowDeps<TConnection>,
): ManualTerminalReflowRunner {
	const flushBufferedLiveChunks = (
		xterm: TerminalReflowXterm | null,
		chunks: Uint8Array[],
	) => {
		if (!xterm || chunks.length === 0) return;
		for (const chunk of chunks) {
			xterm.write(chunk);
		}
		xterm.flush();
	};

	return {
		run: async () => {
			const xterm = deps.getXterm();
			if (!xterm) {
				deps.showFailure('Reflow terminal failed', 'Terminal is not ready.');
				return;
			}

			const size = deps.getTerminalSize();
			if (!size) {
				xterm.fit();
				deps.showFailure(
					'Reflow terminal',
					'Terminal size is not ready yet. Try again.',
				);
				return;
			}

			const connection = deps.getConnection();
			if (!connection) {
				deps.showFailure(
					'Reflow terminal failed',
					'No SSH connection available.',
				);
				return;
			}

			if (!deps.isTmuxEnabled()) {
				deps.showFailure(
					'Reflow terminal failed',
					'Reflow requires a Workmux session.',
				);
				return;
			}

			deps.beginLiveBuffer();
			try {
				const paneContext = await deps.resolvePaneContext();
				const command = buildTmuxCapturePaneCommand({
					paneId: paneContext.paneId,
				});
				const result = await deps.executeSideChannelCommand(
					connection,
					command,
					TERMINAL_REFLOW_TIMEOUT_MS,
				);
				if (!result.success) {
					throw new Error(result.error || result.output || 'Capture failed.');
				}

				const snapshot = formatTerminalReflowSnapshot(result.output, size.cols);
				if (snapshot.length === 0) {
					throw new Error('No pane content was captured.');
				}

				const bufferedLiveChunks = deps.endLiveBuffer();
				xterm.clear();
				xterm.write(snapshot);
				xterm.flush();
				flushBufferedLiveChunks(xterm, bufferedLiveChunks);
			} catch (error) {
				const bufferedLiveChunks = deps.endLiveBuffer();
				flushBufferedLiveChunks(xterm, bufferedLiveChunks);
				deps.showFailure(
					'Reflow terminal failed',
					deps.getErrorMessage(error),
				);
			}
		},
	};
}
```

- [ ] **Step 4: Run the runner tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/terminal-reflow-runner.test.ts
```

Expected: PASS. The output should include:

```text
# pass
```

- [ ] **Step 5: Run Task 1 and Task 2 tests together**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/terminal-reflow.test.ts test/integration/terminal-reflow-runner.test.ts
```

Expected: PASS. The output should include:

```text
# pass
```

- [ ] **Step 6: Commit the runner**

Run:

```bash
git add apps/mobile/src/lib/terminal-reflow-runner.ts apps/mobile/test/integration/terminal-reflow-runner.test.ts
git commit -m "feat(mobile): add manual terminal reflow runner"
```

### Task 3: Native Action And Command Menu Entry

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`

- [ ] **Step 1: Add failing keyboard action tests**

In `apps/mobile/test/integration/keyboard-actions.test.ts`, add this test near the existing action delegation tests:

```ts
void test('terminal reflow action delegates to the action context', async () => {
	let reflowed = 0;

	await runAction('REFLOW_TERMINAL', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		reflowTerminal: async () => {
			reflowed += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(reflowed, 1);
	assert.equal(
		CONFIG_SUPPORTED_ACTION_IDS.includes(
			'REFLOW_TERMINAL' as (typeof CONFIG_SUPPORTED_ACTION_IDS)[number],
		),
		true,
	);
});
```

- [ ] **Step 2: Add failing bundled command menu and schema tests**

In `apps/mobile/test/integration/keyboard-config.test.ts`, add:

```ts
void test('bundled command menu exposes manual terminal reflow under mdev', () => {
	const config = getBundledShellConfig();
	const mdevMenu = config.commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);

	assert.ok(mdevMenu);
	assert.deepEqual(
		mdevMenu.entries.find((entry) => entry.label === 'Reflow terminal'),
		{
			type: 'action',
			label: 'Reflow terminal',
			actionId: 'REFLOW_TERMINAL',
		},
	);
});
```

In `apps/mobile/test/integration/shell-config-schema.test.ts`, add:

```ts
void test('runtime shell config accepts terminal reflow command action entries', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'action',
			label: 'Reflow terminal',
			actionId: 'REFLOW_TERMINAL',
		},
	];

	const parsed = parseShellConfigData(config);

	assert.deepEqual(parsed.commandMenus, [
		{
			type: 'action',
			label: 'Reflow terminal',
			actionId: 'REFLOW_TERMINAL',
		},
	]);
});
```

- [ ] **Step 3: Run the action/config tests to verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts
```

Expected: FAIL with messages showing `REFLOW_TERMINAL` is not supported and `Reflow terminal` is not present in the bundled command menu.

- [ ] **Step 4: Add `REFLOW_TERMINAL` to keyboard action dispatch**

In `apps/mobile/src/lib/keyboard-actions.ts`, add `REFLOW_TERMINAL` to `KNOWN_ACTION_IDS` after `TOGGLE_COMMAND_MENU`:

```ts
export const KNOWN_ACTION_IDS = [
	'ROTATE_KEYBOARD',
	'OPEN_KEYBOARD_SETTINGS',
	...KEYBOARD_TARGET_ACTION_IDS,
	'TOGGLE_COMMAND_MENU',
	'REFLOW_TERMINAL',
	'OPEN_COMMANDER',
```

Add the callback to `ActionContext` after `toggleCommandMenu?: () => void;`:

```ts
	toggleCommandMenu?: () => void;
	reflowTerminal?: () => Promise<void> | void;
	openCommander?: () => void;
```

Add the dispatch case after `TOGGLE_COMMAND_MENU`:

```ts
		case 'REFLOW_TERMINAL': {
			await context.reflowTerminal?.();
			return;
		}
```

- [ ] **Step 5: Add the command menu entry to bundled config**

In `apps/mobile/config/shell-config.json`, update the top-level metadata:

```json
	"version": "2026-06-09.1",
	"updatedAt": "2026-06-09T00:00:00.000Z",
```

In the `mdev` submenu, insert `Reflow terminal` immediately after `Request a Feature`:

```json
				{
					"type": "action",
					"label": "Request a Feature",
					"actionId": "OPEN_REPO_FEATURE_REQUEST"
				},
				{
					"type": "action",
					"label": "Reflow terminal",
					"actionId": "REFLOW_TERMINAL"
				},
				{
					"type": "preset",
					"label": "Open Workspace",
```

- [ ] **Step 6: Run the action/config tests to verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts
```

Expected: PASS. The output should include:

```text
# pass
```

- [ ] **Step 7: Validate the bundled shell config**

Run:

```bash
pnpm --filter @fressh/mobile run validate:shell-config
```

Expected: PASS with no schema validation errors.

- [ ] **Step 8: Commit the action and config entry**

Run:

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/test/integration/keyboard-config.test.ts apps/mobile/test/integration/shell-config-schema.test.ts
git commit -m "feat(mobile): expose terminal reflow action"
```

### Task 4: Shell Detail Wiring And Live Output Buffering

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Expose pane context from the browser action controller**

In `apps/mobile/src/lib/shell-modals.tsx`, update `BrowserActionsControllerHandle` to include `resolveHostBrowserPaneContext`:

```ts
export type BrowserActionsControllerHandle = {
	browserActionsProps: BrowserActionsModalProps;
	hostUrlProps: HostUrlModalProps;
	open: () => void;
	close: () => void;
	resolveHostBrowserPanePath: () => Promise<string>;
	resolveHostBrowserPaneContext: () => Promise<TmuxPaneContext>;
	resolveHostBrowserWorkspace: () => Promise<BrowserActionsWorkspace>;
	resolveCurrentGitHubRepository: () => Promise<string>;
	runHostBrowserCommand: (
		command: string,
		timeoutMs?: number,
	) => Promise<string>;
	invalidateHostUrlReads: () => void;
	invalidateAll: () => void;
};
```

Make sure `TmuxPaneContext` is already imported from `@/lib/host-browser-actions` in the same file. Then add the property to the returned object near `resolveHostBrowserPanePath`:

```ts
	return useMemo<BrowserActionsControllerHandle>(
		() => ({
			browserActionsProps,
			hostUrlProps,
			open: openController,
			close,
			resolveHostBrowserPanePath,
			resolveHostBrowserPaneContext,
			resolveHostBrowserWorkspace,
			resolveCurrentGitHubRepository,
			runHostBrowserCommand,
			invalidateHostUrlReads,
			invalidateAll,
		}),
		[
			browserActionsProps,
			close,
			hostUrlProps,
			invalidateAll,
			invalidateHostUrlReads,
			openController,
			resolveCurrentGitHubRepository,
			resolveHostBrowserPaneContext,
			resolveHostBrowserPanePath,
			resolveHostBrowserWorkspace,
			runHostBrowserCommand,
		],
	);
```

- [ ] **Step 2: Wire `createManualTerminalReflowRunner` into `detail.tsx` imports**

In `apps/mobile/src/app/shell/detail.tsx`, add this import near the other lib imports:

```ts
import { createManualTerminalReflowRunner } from '@/lib/terminal-reflow-runner';
```

- [ ] **Step 3: Add live buffer refs in `ShellDetail`**

In `ShellDetail`, near `lastSelectionRef`, add:

```ts
	const reflowLiveBufferRef = useRef<{
		active: boolean;
		chunks: Uint8Array[];
	}>({
		active: false,
		chunks: [],
	});
```

- [ ] **Step 4: Store terminal size as soon as xterm reports it**

In `handleTerminalResize`, keep the existing `lastSizeRef.current = { cols, rows };` assignment. No extra state is needed because Task 4 uses `lastSizeRef.current` directly.

- [ ] **Step 5: Buffer live output while reflow is active**

Replace `writeShellChunkToTerminal` in `apps/mobile/src/app/shell/detail.tsx` with:

```ts
	const writeShellChunkToTerminal = useCallback((bytesBuffer: ArrayBuffer) => {
		const bytes = new Uint8Array(bytesBuffer);
		if (reflowLiveBufferRef.current.active) {
			reflowLiveBufferRef.current.chunks.push(new Uint8Array(bytes));
			return;
		}
		xtermRef.current?.write(bytes);
	}, []);
```

- [ ] **Step 6: Add the manual reflow runner and action callback**

After `browserActions` is created and before `workmuxKeyboardTmuxEnabledRef`, add:

```ts
	const manualTerminalReflowRunner = useMemo(
		() =>
			createManualTerminalReflowRunner({
				getConnection: () => connection ?? null,
				isTmuxEnabled: () => tmuxEnabled,
				getTerminalSize: () => lastSizeRef.current,
				getXterm: () => xtermRef.current,
				resolvePaneContext: browserActions.resolveHostBrowserPaneContext,
				executeSideChannelCommand,
				beginLiveBuffer: () => {
					reflowLiveBufferRef.current = {
						active: true,
						chunks: [],
					};
				},
				endLiveBuffer: () => {
					const chunks = reflowLiveBufferRef.current.chunks;
					reflowLiveBufferRef.current = {
						active: false,
						chunks: [],
					};
					return chunks;
				},
				showFailure: (title, message) => {
					Alert.alert(title, message);
				},
				getErrorMessage,
			}),
		[connection, browserActions.resolveHostBrowserPaneContext, tmuxEnabled],
	);

	const handleReflowTerminal = useCallback(() => {
		commandMenuModal.onClose();
		void manualTerminalReflowRunner.run();
	}, [commandMenuModal, manualTerminalReflowRunner]);
```

If ESLint reports `executeSideChannelCommand` or `getErrorMessage` as missing dependencies, do not add them because they are stable module-level functions declared outside the component. Add dependencies only for values declared inside `ShellDetail`.

- [ ] **Step 7: Add `reflowTerminal` to the action context**

In the `actionContext` object, add `reflowTerminal: handleReflowTerminal` after `toggleCommandMenu`:

```ts
			toggleCommandMenu: () => {
				browserActions.invalidateHostUrlReads();
				commanderModal.onClose();
				browserActions.close();
				skillSelector.close();
				handleCloseTextEntry();
				if (commandMenuModal.open) {
					commandMenuModal.onClose();
				} else {
					commandMenuModal.onOpen();
				}
			},
			reflowTerminal: handleReflowTerminal,
			openCommander: () => {
```

Add `handleReflowTerminal` to the `useMemo` dependency list:

```ts
			handleReflowTerminal,
```

- [ ] **Step 8: Run TypeScript to verify wiring**

Run:

```bash
pnpm --filter @fressh/mobile run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 9: Run focused integration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/terminal-reflow.test.ts test/integration/terminal-reflow-runner.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts test/integration/shell-config-schema.test.ts test/integration/browser-actions-controller-actions.test.ts
```

Expected: PASS. The output should include:

```text
# pass
```

- [ ] **Step 10: Commit shell wiring**

Run:

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): wire terminal reflow command"
```

### Task 5: Verification And POC Notes

**Files:**
- No planned file edits. This task verifies the implemented POC.

- [ ] **Step 1: Run mobile lint check**

Run:

```bash
pnpm --filter @fressh/mobile run lint:check
```

Expected: PASS with no ESLint errors. If import ordering fails, run:

```bash
pnpm --filter @fressh/mobile run fmt
```

Then rerun:

```bash
pnpm --filter @fressh/mobile run lint:check
```

Expected: PASS.

- [ ] **Step 2: Run the full mobile integration suite**

Run:

```bash
pnpm --filter @fressh/mobile run test:integration
```

Expected: PASS. The output should include:

```text
# fail 0
```

- [ ] **Step 3: Run shell config validation**

Run:

```bash
pnpm --filter @fressh/mobile run validate:shell-config
```

Expected: PASS with no validation errors.

- [ ] **Step 4: Run a local tmux sanity check for the capture command**

Run:

```bash
SOCK=fressh-reflow-plan-check-$$
tmux -f /dev/null -L "$SOCK" new-session -d -s reflow -x 120 -y 20 'bash --noprofile --norc'
sleep 0.2
tmux -f /dev/null -L "$SOCK" send-keys -t reflow:0.0 "python3 -c 'print(\"START:\" + \"abcdefghijklmnopqrstuvwxyz\"*6 + \":END\")'" C-m
sleep 0.5
PANE_ID=$(tmux -f /dev/null -L "$SOCK" display-message -p -t reflow:0.0 '#{pane_id}')
tmux -f /dev/null -L "$SOCK" capture-pane -J -p -t "$PANE_ID" -S -300 -E - | sed -n '1,8p'
tmux -f /dev/null -L "$SOCK" kill-server
```

Expected: output includes one joined long `START:...:END` line from `capture-pane -J`. This command uses a private tmux socket and does not touch the user's normal tmux server.

- [ ] **Step 5: Manual Android preview verification**

Use the existing preview build workflow. If a preview build is already installed, ship JS with OTA:

```bash
cd apps/mobile && pnpm exec eas update --channel preview --message "Manual terminal reflow POC"
```

Expected: EAS update completes and prints an update ID.

Then verify on device:

1. Open the same Workmux session in a wide desktop client and in the mobile app portrait terminal.
2. In the wide desktop client, run a command that prints long lines:

```bash
python3 -c 'print("START:" + "abcdefghijklmnopqrstuvwxyz"*8 + ":END")'
```

3. Confirm the mobile terminal shows the wide-layout problem before reflow.
4. On mobile, open `Cmds > mdev > Reflow terminal`.
5. Confirm the mobile terminal shows visible pane plus recent history wrapped to portrait width.
6. Confirm the desktop tmux client remains wide.
7. Print another long line from the desktop client and confirm mobile continues receiving live output.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: no uncommitted files unless manual verification produced local runtime artifacts outside git.

## Self-Review

Spec coverage:

- Manual command in existing `Cmds` menu: Task 3.
- Visible pane plus recent history: Task 1 capture command uses `-S -300 -E -`; Task 2 runner uses the command.
- No shared tmux resizing: Task 1 command uses only `capture-pane -J`; no task adds `resize-window`.
- Local wrapping to current terminal width: Task 1 formatter and Task 2 runner.
- Keep live listener running and buffer live chunks during rebuild: Task 2 runner and Task 4 `writeShellChunkToTerminal` buffering.
- User-facing failures without clearing current view on failure: Task 2 tests and runner.
- Focused tests and manual verification: Tasks 1 through 5.

Placeholder scan:

- The plan contains no `TODO`, `TBD`, or undefined implementation slots.
- Manual POC observations should be reported in the execution final response.

Type consistency:

- `REFLOW_TERMINAL` is added to `KNOWN_ACTION_IDS`, accepted by `CONFIG_SUPPORTED_ACTION_IDS`, dispatched through `runAction`, and exposed in JSON.
- `ManualTerminalReflowDeps` names match the runner tests and Task 4 shell wiring.
- `TerminalReflowXterm` uses methods already exposed by `XtermWebViewHandle`: `clear`, `write`, `flush`, and `fit`.
