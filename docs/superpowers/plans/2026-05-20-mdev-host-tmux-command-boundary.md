# Mdev Host/Tmux Command Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy host/tmux helper command strings in the mobile app with direct `mdev` command equivalents while preserving the existing keyboard and browser action flows.

**Architecture:** Keep the app-owned UX and side-channel SSH flow unchanged. Update only the command-builder boundary in `apps/mobile/src/lib/host-browser-actions.ts`, with focused integration tests proving the generated shell commands use `mdev` and still quote dynamic values safely.

**Tech Stack:** Expo React Native app, TypeScript, Node `node:test` integration tests, pnpm workspace filters.

---

## File Structure

- Modify: `apps/mobile/test/integration/host-browser-actions.test.ts`
  - Owns focused tests for host browser command builders and URL parsing.
  - Update the existing command-builder test expectations from legacy utilities to `mdev`.
  - Add a direct happy-path assertion for the plain `main` status command from the approved spec.

- Modify: `apps/mobile/src/lib/host-browser-actions.ts`
  - Owns pure command builders for host browser, tmux URL, Diffity, and status-cycle actions.
  - Replace only command strings that have direct `mdev` equivalents.
  - Leave `buildHostBrowserPanePathCommand`, URL parsing, URL extraction, and slot helpers unchanged.

- Do not modify: `apps/mobile/config/shell-config.json`
  - The `Status` key remains `CYCLE_WORKMUX_STATUS`.

- Do not modify: `apps/mobile/src/lib/tmux-scrollback.ts`
  - `mdev` does not currently replace copy-mode or scroll batching commands.

## Task 1: Update Command Builder Tests First

**Files:**
- Modify: `apps/mobile/test/integration/host-browser-actions.test.ts`

- [ ] **Step 1: Update failing expectations for `mdev` commands**

Replace the existing `host browser command builders shell-quote dynamic values`
test with this version:

```ts
void test('host browser command builders shell-quote dynamic values', () => {
	assert.equal(
		buildHostBrowserPanePathCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{pane_current_path}'",
	);
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
```

- [ ] **Step 2: Add the direct spec assertion for the `main` status command**

Add this test immediately after the shell-quoting command-builder test:

```ts
void test('status cycle command uses mdev tmux nav cycle for main session', () => {
	assert.equal(
		buildHostBrowserStatusCycleCommand('main'),
		"mdev tmux nav cycle 'main:'",
	);
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: FAIL. The failure shows the current implementation still emits
legacy commands such as `diffity-share`, `tmux-window-config-url`, or
`tmux-nav.sh cycle`.

- [ ] **Step 4: Leave the failing tests uncommitted**

Do not commit yet. Keep the failing test changes in the worktree so the next
task can make them pass and commit a green test-plus-implementation change.

## Task 2: Switch Host/Tmux Command Builders To `mdev`

**Files:**
- Modify: `apps/mobile/src/lib/host-browser-actions.ts`

- [ ] **Step 1: Update the Diffity command builder**

Change:

```ts
export function buildDiffityShareCommand(panePath: string): string {
	return `cd ${quoteShell(panePath)} && diffity-share`;
}
```

to:

```ts
export function buildDiffityShareCommand(panePath: string): string {
	return `cd ${quoteShell(panePath)} && mdev diffity share`;
}
```

- [ ] **Step 2: Update the tmux URL get command builder**

Change:

```ts
export function buildTmuxWindowConfigGetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} tmux-window-config-url get ${quoteShell(slot)}`;
}
```

to:

```ts
export function buildTmuxWindowConfigGetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} mdev tmux url get ${quoteShell(slot)}`;
}
```

- [ ] **Step 3: Update the tmux URL set command builder**

Change:

```ts
export function buildTmuxWindowConfigSetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
	url: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} tmux-window-config-url set-value ${quoteShell(slot)} ${quoteShell(url)}`;
}
```

to:

```ts
export function buildTmuxWindowConfigSetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
	url: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} mdev tmux url set-value ${quoteShell(slot)} ${quoteShell(url)}`;
}
```

- [ ] **Step 4: Update the status cycle command builder**

Change:

```ts
export function buildHostBrowserStatusCycleCommand(
	tmuxSessionName: string,
): string {
	return `tmux-nav.sh cycle ${quoteShell(`${tmuxSessionName}:`)}`;
}
```

to:

```ts
export function buildHostBrowserStatusCycleCommand(
	tmuxSessionName: string,
): string {
	return `mdev tmux nav cycle ${quoteShell(`${tmuxSessionName}:`)}`;
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: PASS for `apps/mobile/test/integration/host-browser-actions.test.ts`.

- [ ] **Step 6: Commit the passing test and implementation**

```bash
git add apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "fix(mobile): use mdev for host tmux commands"
```

## Task 3: Verify Scope And Package Health

**Files:**
- Inspect: `apps/mobile/src/lib/host-browser-actions.ts`
- Inspect: `apps/mobile/test/integration/host-browser-actions.test.ts`
- Inspect: `apps/mobile/config/shell-config.json`
- Inspect: `apps/mobile/src/lib/tmux-scrollback.ts`

- [ ] **Step 1: Confirm no legacy command strings remain in the command-builder file**

Run:

```bash
rg -n 'tmux-nav\.sh|tmux-window-config-url|diffity-share' apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
```

Expected: no matches.

- [ ] **Step 2: Confirm untouched files remain untouched**

Run:

```bash
git diff -- apps/mobile/config/shell-config.json apps/mobile/src/lib/tmux-scrollback.ts
```

Expected: no output.

- [ ] **Step 3: Run the full mobile integration test suite**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS.

- [ ] **Step 4: Run the mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD~2..HEAD
git diff HEAD~2..HEAD -- apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
```

Expected:

- only `apps/mobile/src/lib/host-browser-actions.ts` and
  `apps/mobile/test/integration/host-browser-actions.test.ts` changed in these
  implementation commits
- `buildHostBrowserPanePathCommand` still uses `tmux display-message`
- no fallback command path exists

- [ ] **Step 6: Commit formatting fixes only if verification changed files**

No commit is needed if Step 1 through Step 5 produce no file changes. If
formatting or lint fixes changed files, commit them:

```bash
git add apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "chore(mobile): verify mdev host tmux commands"
```

## Final Handoff

Report:

- commands changed from legacy utilities to `mdev`
- tests and typecheck run, with results
- commit hashes created during execution
- confirmation that keyboard config and tmux scrollback files were not modified
- any residual risk, especially whether remote hosts have `mdev` installed
