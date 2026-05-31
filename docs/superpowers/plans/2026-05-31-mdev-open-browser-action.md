# Mdev Open Browser Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible `App` browser action with `Open` and `Pick` actions that trigger `mdev open auto` and `mdev open pick`.

**Architecture:** Keep the change on the existing browser-action path. Add pure host-browser command builders and a pane-context parser, update browser action row/intent definitions, wire modal and keyboard callbacks into `useBrowserActionsController`, and remove the visible `app-url` action from bundled keyboard surfaces while leaving low-level `app-url` support intact.

**Tech Stack:** Expo React Native, TypeScript, Node `node:test`, runtime shell config JSON, existing SSH side-channel command execution.

---

## File Structure

- Modify `apps/mobile/src/lib/host-browser-actions.ts`
  - Add `HostBrowserOpenMode`, `TmuxPaneContext`, `buildHostBrowserPaneContextCommand`, `parseTmuxPaneContextOutput`, and `buildMdevOpenCommand`.
  - Keep existing URL slot helpers, including `app-url`, for compatibility.
- Modify `apps/mobile/test/integration/host-browser-actions.test.ts`
  - Add focused tests for pane-context parsing and `mdev open` command quoting.
- Modify `apps/mobile/src/lib/browser-actions.ts`
  - Add `Open` and `Pick` static browser action rows.
  - Remove visible `url-app` from `BROWSER_ACTION_ROWS`.
  - Add detected-open press intents.
- Modify `apps/mobile/test/integration/browser-actions.test.ts`
  - Update approved browser row order and URL row expectations.
  - Add detected-open intent expectations.
- Modify `apps/mobile/src/app/shell/components/browser-actions-modal-controller.ts`
  - Add callbacks for detected auto/pick actions.
- Modify `apps/mobile/test/integration/browser-actions-modal-controller.test.ts`
  - Verify modal controller dispatches `Open` and `Pick`.
- Modify `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
  - Add props for detected auto/pick callbacks and pass them through the controller callback object.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`
  - Add runtime action IDs for direct keyboard access to detected auto/pick.
- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`
  - Verify the new runtime action IDs delegate to the action context.
- Modify `apps/mobile/config/shell-config.json`
  - Replace the `App` browser keyboard key with `Open` and add `Pick`.
  - Bump `version` and `updatedAt`.
- Modify `apps/mobile/test/integration/keyboard-config.test.ts`
  - Update browser keyboard expectations and assert it no longer exposes `OPEN_HOST_URL_APP`.
- Modify `apps/mobile/src/lib/shell-modals.tsx`
  - Resolve pane id, tty, and path in one tmux read.
  - Execute `mdev open auto` and `mdev open pick` through existing side-channel flow.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Pass detected-open callbacks into `runAction` context through existing `browserActions.browserActionsProps`.

## Task 1: Host Browser Command Builders

**Files:**
- Modify: `apps/mobile/src/lib/host-browser-actions.ts`
- Test: `apps/mobile/test/integration/host-browser-actions.test.ts`

- [ ] **Step 1: Write failing tests for pane context and `mdev open` commands**

Add these imports in `apps/mobile/test/integration/host-browser-actions.test.ts`:

```ts
import {
	buildDiffityShareCommand,
	buildHostBrowserPaneContextCommand,
	buildHostBrowserPanePathCommand,
	buildHostBrowserStatusCycleCommand,
	buildMdevOpenCommand,
	buildTmuxCurrentWindowIdCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	isHostBrowserUrlSlot,
	parseHostBrowserUrlInput,
	parseTmuxPaneContextOutput,
} from '../../src/lib/host-browser-actions';
```

Add these tests after `current window id command shell-quotes tmux session`:

```ts
void test('pane context command shell-quotes tmux session', () => {
	assert.equal(
		buildHostBrowserPaneContextCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{pane_id}\t#{pane_tty}\t#{pane_current_path}'",
	);
});

void test('parseTmuxPaneContextOutput returns the last complete pane context line', () => {
	assert.deepEqual(
		parseTmuxPaneContextOutput(
			[
				'noise',
				'%2\t/dev/pts/7\t/home/muly/work repo',
				'',
				'%3\t/dev/pts/8\t/tmp/repo with spaces',
			].join('\n'),
		),
		{
			paneId: '%3',
			paneTty: '/dev/pts/8',
			panePath: '/tmp/repo with spaces',
		},
	);
});

void test('parseTmuxPaneContextOutput rejects malformed pane context output', () => {
	assert.equal(parseTmuxPaneContextOutput(''), null);
	assert.equal(parseTmuxPaneContextOutput('%1\t/dev/pts/1'), null);
	assert.equal(parseTmuxPaneContextOutput('\t/dev/pts/1\t/tmp/repo'), null);
	assert.equal(parseTmuxPaneContextOutput('%1\t\t/tmp/repo'), null);
	assert.equal(parseTmuxPaneContextOutput('%1\t/dev/pts/1\t'), null);
});

void test('mdev open command shell-quotes pane context values', () => {
	assert.equal(
		buildMdevOpenCommand('auto', {
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: "/home/muly/work repo's",
		}),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo'\\''s' mdev open auto",
	);
	assert.equal(
		buildMdevOpenCommand('pick', {
			paneId: '%12',
			paneTty: '/dev/pts/7',
			panePath: '/home/muly/work repo',
		}),
		"TMUX_PANE='%12' TMUX_PANE_TTY='/dev/pts/7' TMUX_PANE_PATH='/home/muly/work repo' mdev open pick",
	);
});
```

- [ ] **Step 2: Run the host-browser action tests and verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: FAIL because `buildHostBrowserPaneContextCommand`, `parseTmuxPaneContextOutput`, and `buildMdevOpenCommand` are not exported.

- [ ] **Step 3: Add pane context and `mdev open` helpers**

In `apps/mobile/src/lib/host-browser-actions.ts`, add these types after `HostBrowserUrlSlot`:

```ts
export type HostBrowserOpenMode = 'auto' | 'pick';

export type TmuxPaneContext = {
	paneId: string;
	paneTty: string;
	panePath: string;
};
```

Add this function after `buildHostBrowserPanePathCommand`:

```ts
export function buildHostBrowserPaneContextCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{pane_id}\t#{pane_tty}\t#{pane_current_path}'`;
}
```

Add these functions after `buildTmuxWindowConfigSetCommand`:

```ts
export function parseTmuxPaneContextOutput(
	output: string,
): TmuxPaneContext | null {
	const line = output
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean)
		.at(-1);
	if (!line) return null;

	const [paneIdRaw, paneTtyRaw, ...panePathParts] = line.split('\t');
	const paneId = paneIdRaw?.trim() ?? '';
	const paneTty = paneTtyRaw?.trim() ?? '';
	const panePath = panePathParts.join('\t').trim();
	if (!paneId || !paneTty || !panePath) return null;

	return { paneId, paneTty, panePath };
}

export function buildMdevOpenCommand(
	mode: HostBrowserOpenMode,
	context: TmuxPaneContext,
): string {
	return [
		`TMUX_PANE=${quoteShell(context.paneId)}`,
		`TMUX_PANE_TTY=${quoteShell(context.paneTty)}`,
		`TMUX_PANE_PATH=${quoteShell(context.panePath)}`,
		'mdev',
		'open',
		mode,
	].join(' ');
}
```

- [ ] **Step 4: Run the host-browser action tests and verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "feat(mobile): add mdev open command builders"
```

## Task 2: Browser Action Rows And Intents

**Files:**
- Modify: `apps/mobile/src/lib/browser-actions.ts`
- Test: `apps/mobile/test/integration/browser-actions.test.ts`

- [ ] **Step 1: Update browser action tests for Open/Pick and no App row**

In `apps/mobile/test/integration/browser-actions.test.ts`, change the expected row order in `browser action rows expose the approved order and URL editability` to:

```ts
[
	'diff',
	'github-issues',
	'github-pulls',
	'open-detected-auto',
	'open-detected-pick',
	'url-window',
	'url-dev-server',
	'url-storybook',
]
```

Change the expected URL slots in the same test to:

```ts
['window-url', 'dev-web-server-url', 'storybook-url']
```

Change the row type assertions in the same test to:

```ts
assert.equal(isBrowserActionUrlRow(BROWSER_ACTION_ROWS[0]!), false);
assert.equal(isBrowserActionUrlRow(BROWSER_ACTION_ROWS[5]!), true);
```

In `browser action press intent keeps static rows as open actions in every mode`, add these expected cases:

```ts
assert.deepEqual(
	getBrowserActionPressIntent(BROWSER_ACTION_ROWS[3]!, mode),
	{ type: 'open-detected-auto' },
);
assert.deepEqual(
	getBrowserActionPressIntent(BROWSER_ACTION_ROWS[4]!, mode),
	{ type: 'open-detected-pick' },
);
```

In `browser action press intent opens URL slots in open mode`, change the expected array to:

```ts
[
	{ type: 'open-url-slot', slot: 'window-url' },
	{ type: 'open-url-slot', slot: 'dev-web-server-url' },
	{ type: 'open-url-slot', slot: 'storybook-url' },
]
```

In `browser action press intent edits URL slots in set mode`, change the expected array to:

```ts
[
	{ type: 'edit-url-slot', slot: 'window-url' },
	{ type: 'edit-url-slot', slot: 'dev-web-server-url' },
	{ type: 'edit-url-slot', slot: 'storybook-url' },
]
```

- [ ] **Step 2: Run browser action tests and verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/browser-actions.test.ts
```

Expected: FAIL because `browser-actions.ts` still exposes `url-app` and does not expose detected-open intents.

- [ ] **Step 3: Update browser action types, rows, and intent mapping**

In `apps/mobile/src/lib/browser-actions.ts`, replace `BrowserActionStaticRowId` with:

```ts
export type BrowserActionStaticRowId =
	| 'diff'
	| 'github-issues'
	| 'github-pulls'
	| 'open-detected-auto'
	| 'open-detected-pick';
```

Replace `BrowserActionUrlRowId` with:

```ts
export type BrowserActionUrlRowId =
	| 'url-window'
	| 'url-dev-server'
	| 'url-storybook';
```

Add detected-open intent variants to `BrowserActionPressIntent`:

```ts
export type BrowserActionPressIntent =
	| { type: 'open-diff' }
	| { type: 'open-github-issues' }
	| { type: 'open-github-pulls' }
	| { type: 'open-detected-auto' }
	| { type: 'open-detected-pick' }
	| { type: 'open-url-slot'; slot: HostBrowserUrlSlot }
	| { type: 'edit-url-slot'; slot: HostBrowserUrlSlot };
```

Insert these rows after the GitHub Pull Requests row in `BROWSER_ACTION_ROWS`:

```ts
{
	id: 'open-detected-auto',
	type: 'static',
	label: 'Open',
	description: 'Open detected URL or file from the active pane',
	icon: 'ExternalLink',
},
{
	id: 'open-detected-pick',
	type: 'static',
	label: 'Pick',
	description: 'Choose from detected URLs and files in the active pane',
	icon: 'List',
},
```

Remove this row from `BROWSER_ACTION_ROWS`:

```ts
{
	id: 'url-app',
	type: 'url-slot',
	label: 'App',
	description: 'Open or set the saved app URL',
	icon: 'PanelTop',
	slot: 'app-url',
},
```

Add these cases to the static-row switch in `getBrowserActionPressIntent`:

```ts
case 'open-detected-auto':
	return { type: 'open-detected-auto' };
case 'open-detected-pick':
	return { type: 'open-detected-pick' };
```

- [ ] **Step 4: Run browser action tests and verify they pass**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/mobile/src/lib/browser-actions.ts apps/mobile/test/integration/browser-actions.test.ts
git commit -m "feat(mobile): expose detected browser actions"
```

## Task 3: Browser Actions Modal Controller Wiring

**Files:**
- Modify: `apps/mobile/src/app/shell/components/browser-actions-modal-controller.ts`
- Modify: `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
- Test: `apps/mobile/test/integration/browser-actions-modal-controller.test.ts`

- [ ] **Step 1: Write failing modal-controller tests for Open/Pick**

In `apps/mobile/test/integration/browser-actions-modal-controller.test.ts`, add these callbacks in `createCallbacks`:

```ts
onOpenDetectedAuto: () => {
	state.calls.push('open-detected-auto');
},
onOpenDetectedPick: () => {
	state.calls.push('open-detected-pick');
},
```

Add these cases to the `cases` array in `browser actions modal controller keeps static rows open in set mode`:

```ts
{ id: 'open-detected-auto', expected: 'open-detected-auto' },
{ id: 'open-detected-pick', expected: 'open-detected-pick' },
```

- [ ] **Step 2: Run modal-controller tests and verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/browser-actions-modal-controller.test.ts
```

Expected: FAIL because `BrowserActionsModalCallbacks` does not define detected-open callbacks and the controller does not handle detected-open intents.

- [ ] **Step 3: Add detected-open callbacks to the controller**

In `apps/mobile/src/app/shell/components/browser-actions-modal-controller.ts`, add these fields to `BrowserActionsModalCallbacks`:

```ts
onOpenDetectedAuto: () => void;
onOpenDetectedPick: () => void;
```

Add these cases to the `switch (intent.type)` block in `handleBrowserActionsModalRowPress`:

```ts
case 'open-detected-auto':
	runAndClose(callbacks, callbacks.onOpenDetectedAuto);
	return;
case 'open-detected-pick':
	runAndClose(callbacks, callbacks.onOpenDetectedPick);
	return;
```

- [ ] **Step 4: Wire detected-open props through the React modal**

In `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`, add these props to the destructuring list:

```ts
onOpenDetectedAuto,
onOpenDetectedPick,
```

Add these prop types:

```ts
onOpenDetectedAuto: () => void;
onOpenDetectedPick: () => void;
```

Add these fields to the `callbacks` object:

```ts
onOpenDetectedAuto,
onOpenDetectedPick,
```

Add both variables to the `useMemo` dependency array:

```ts
onOpenDetectedAuto,
onOpenDetectedPick,
```

- [ ] **Step 5: Run modal-controller tests and TypeScript-adjacent tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/browser-actions-modal-controller.test.ts test/integration/browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add apps/mobile/src/app/shell/components/browser-actions-modal-controller.ts apps/mobile/src/app/shell/components/BrowserActionsModal.tsx apps/mobile/test/integration/browser-actions-modal-controller.test.ts
git commit -m "feat(mobile): wire detected browser modal actions"
```

## Task 4: Runtime Keyboard Action IDs And Bundled Config

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Write failing keyboard action tests**

In `apps/mobile/test/integration/keyboard-actions.test.ts`, add `detectedCalls` to `host browser actions delegate to action context callbacks`:

```ts
const detectedCalls: string[] = [];
```

Add this callback to the `context` object:

```ts
openHostDetected: (mode: string) => {
	detectedCalls.push(mode);
},
```

After `await runAction('OPEN_HOST_URL_APP', context);`, add:

```ts
await runAction('OPEN_HOST_DETECTED_AUTO', context);
await runAction('OPEN_HOST_DETECTED_PICK', context);
```

After the `openedSlots` assertion, add:

```ts
assert.deepEqual(detectedCalls, ['auto', 'pick']);
```

At the end of that test, add:

```ts
assert.equal(KNOWN_ACTION_IDS.includes('OPEN_HOST_DETECTED_AUTO'), true);
assert.equal(KNOWN_ACTION_IDS.includes('OPEN_HOST_DETECTED_PICK'), true);
```

- [ ] **Step 2: Write failing bundled keyboard config expectations**

In `apps/mobile/test/integration/keyboard-config.test.ts`, replace the expected `browserKeyboard.grid[0]?.slice(0, 6)` array with `slice(0, 7)` and this value:

```ts
[
	{
		type: 'action',
		actionId: 'OPEN_MAIN_MENU',
		label: 'Back',
		icon: 'X',
	},
	{
		type: 'action',
		actionId: 'OPEN_HOST_DIFFITY',
		label: 'Diff',
		icon: 'GitCompare',
	},
	{
		type: 'action',
		actionId: 'OPEN_HOST_URL_WINDOW',
		label: 'URL',
		icon: 'Link',
	},
	{
		type: 'action',
		actionId: 'OPEN_HOST_URL_DEV_SERVER',
		label: 'Web',
		icon: 'Globe',
	},
	{
		type: 'action',
		actionId: 'OPEN_HOST_URL_STORYBOOK',
		label: 'Story',
		icon: 'BookOpen',
	},
	{
		type: 'action',
		actionId: 'OPEN_HOST_DETECTED_AUTO',
		label: 'Open',
		icon: 'ExternalLink',
	},
	{
		type: 'action',
		actionId: 'OPEN_HOST_DETECTED_PICK',
		label: 'Pick',
		icon: 'List',
	},
]
```

Replace the next assertion with:

```ts
assert.deepEqual(browserKeyboard.grid[0]?.slice(7, 10), [null, null, null]);
```

Before `assert.deepEqual(config.macrosByKeyboardId.browser_keyboard, []);`, add:

```ts
const browserKeyboardActionIds = browserKeyboard.grid.flatMap((row) =>
	row.flatMap((item) => (item?.type === 'action' ? [item.actionId] : [])),
);
assert.equal(browserKeyboardActionIds.includes('OPEN_HOST_URL_APP'), false);
```

- [ ] **Step 3: Run keyboard tests and verify they fail**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts
```

Expected: FAIL because the new action IDs and config rows are not implemented.

- [ ] **Step 4: Add runtime action IDs and action context callback**

In `apps/mobile/src/lib/keyboard-actions.ts`, add these action IDs immediately after `OPEN_HOST_URL_APP`:

```ts
'OPEN_HOST_DETECTED_AUTO',
'OPEN_HOST_DETECTED_PICK',
```

Add this field to `ActionContext`:

```ts
openHostDetected?: (mode: 'auto' | 'pick') => void;
```

Add these cases to `runAction` immediately after `OPEN_HOST_URL_APP`:

```ts
case 'OPEN_HOST_DETECTED_AUTO': {
	context.openHostDetected?.('auto');
	return;
}
case 'OPEN_HOST_DETECTED_PICK': {
	context.openHostDetected?.('pick');
	return;
}
```

- [ ] **Step 5: Update bundled shell config browser keyboard**

In `apps/mobile/config/shell-config.json`, update the top metadata:

```json
"version": "2026-05-31.1",
"updatedAt": "2026-05-31T00:00:00Z",
```

In the `browser_keyboard` first row, replace the `OPEN_HOST_URL_APP` item with:

```json
{
	"type": "action",
	"actionId": "OPEN_HOST_DETECTED_AUTO",
	"label": "Open",
	"icon": "ExternalLink"
},
{
	"type": "action",
	"actionId": "OPEN_HOST_DETECTED_PICK",
	"label": "Pick",
	"icon": "List"
}
```

Keep the row at 10 cells by leaving the remaining entries as `null`.

- [ ] **Step 6: Run keyboard tests and shell config validation**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts
pnpm --dir apps/mobile validate:shell-config
```

Expected: PASS for both commands.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "feat(mobile): replace app browser key with detected open"
```

## Task 5: Execute Detected Open Through Shell Modal Controller

**Files:**
- Modify: `apps/mobile/src/lib/shell-modals.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`
- Test: covered by focused unit tests from Tasks 1-4 plus TypeScript/lint in Task 6

- [ ] **Step 1: Update imports in shell modal controller**

In `apps/mobile/src/lib/shell-modals.tsx`, extend the host-browser-actions import with:

```ts
buildHostBrowserPaneContextCommand,
buildMdevOpenCommand,
parseTmuxPaneContextOutput,
type HostBrowserOpenMode,
```

- [ ] **Step 2: Add detected-open props and handle shape**

In `BrowserActionsModalProps`, add:

```ts
onOpenDetectedAuto: () => void;
onOpenDetectedPick: () => void;
```

- [ ] **Step 3: Add request state for detected-open commands**

Near the existing `hostDiffityRequestId` and `hostDiffityInFlightRef`, add:

```ts
const hostDetectedOpenRequestId = useRequestId();
const hostDetectedOpenInFlightRef = useRef(false);
```

- [ ] **Step 4: Add pane-context resolver**

After `resolveHostBrowserPanePath`, add:

```ts
const resolveHostBrowserPaneContext = useCallback(async () => {
	if (!tmuxEnabled) {
		throw new Error(
			'Host browser actions require a tmux-enabled connection.',
		);
	}
	const sessionName = tmuxTarget.trim() || 'main';
	const output = await runHostBrowserCommand(
		buildHostBrowserPaneContextCommand(sessionName),
		10_000,
	);
	const context = parseTmuxPaneContextOutput(output);
	if (!context) {
		throw new Error(
			`Could not resolve pane context for tmux session ${sessionName}.`,
		);
	}
	return context;
}, [runHostBrowserCommand, tmuxEnabled, tmuxTarget]);
```

- [ ] **Step 5: Add detected-open handler**

After `handleOpenHostDiffity`, add:

```ts
const handleOpenDetected = useCallback(
	(mode: HostBrowserOpenMode) => {
		if (hostDetectedOpenInFlightRef.current) return;
		setOpen(false);
		const id = hostDetectedOpenRequestId.next();
		hostDetectedOpenInFlightRef.current = true;
		void (async () => {
			try {
				const context = await resolveHostBrowserPaneContext();
				if (!hostDetectedOpenRequestId.isCurrent(id)) return;
				await runHostBrowserCommand(
					buildMdevOpenCommand(mode, context),
					mode === 'pick' ? 60_000 : 30_000,
				);
			} catch (err) {
				if (!hostDetectedOpenRequestId.isCurrent(id)) return;
				showError(
					mode === 'pick' ? 'Pick failed' : 'Open failed',
					getErrorMessage(err),
				);
			} finally {
				if (hostDetectedOpenRequestId.isCurrent(id)) {
					hostDetectedOpenInFlightRef.current = false;
				}
			}
		})();
	},
	[
		getErrorMessage,
		hostDetectedOpenRequestId,
		resolveHostBrowserPaneContext,
		runHostBrowserCommand,
		showError,
	],
);
```

Add these wrappers after the handler:

```ts
const handleOpenDetectedAuto = useCallback(
	() => handleOpenDetected('auto'),
	[handleOpenDetected],
);

const handleOpenDetectedPick = useCallback(
	() => handleOpenDetected('pick'),
	[handleOpenDetected],
);
```

- [ ] **Step 6: Include detected-open request state in invalidation paths**

In `invalidateAll`, add:

```ts
hostDetectedOpenRequestId.invalidate();
hostDetectedOpenInFlightRef.current = false;
```

In the cleanup `useEffect`, add:

```ts
hostDetectedOpenRequestId.invalidate();
hostDetectedOpenInFlightRef.current = false;
```

Add `hostDetectedOpenRequestId` to both dependency arrays.

- [ ] **Step 7: Pass detected-open callbacks through `browserActionsProps`**

In the `browserActionsProps` object, add:

```ts
onOpenDetectedAuto: handleOpenDetectedAuto,
onOpenDetectedPick: handleOpenDetectedPick,
```

Add these callbacks to the `useMemo` dependency array:

```ts
handleOpenDetectedAuto,
handleOpenDetectedPick,
```

- [ ] **Step 8: Pass detected-open callback into keyboard action context**

In `apps/mobile/src/app/shell/detail.tsx`, add this field to the `runAction` context object near the existing host-browser callbacks:

```ts
openHostDetected: (mode) => {
	if (mode === 'pick') {
		browserActions.browserActionsProps.onOpenDetectedPick();
		return;
	}
	browserActions.browserActionsProps.onOpenDetectedAuto();
},
```

- [ ] **Step 9: Run focused tests that exercise the new wiring contracts**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts test/integration/browser-actions.test.ts test/integration/browser-actions-modal-controller.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

Run:

```bash
git add apps/mobile/src/lib/shell-modals.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): run mdev open from browser actions"
```

## Task 6: Final Verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Run shell config validation**

Run:

```bash
pnpm --dir apps/mobile validate:shell-config
```

Expected: PASS.

- [ ] **Step 2: Run focused integration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts test/integration/browser-actions.test.ts test/integration/browser-actions-modal-controller.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run mobile type/lint check**

Run:

```bash
pnpm --filter @fressh/mobile lint:check
```

Expected: PASS.

- [ ] **Step 4: Run repo status check**

Run:

```bash
git status --short
```

Expected: no uncommitted changes unless verification generated local artifacts. If generated artifacts appear, inspect them before deciding whether they belong in a commit.

- [ ] **Step 5: Commit verification notes if any tracked files changed**

If verification required a tracked-file adjustment, run:

```bash
git add <changed-files>
git commit -m "chore(mobile): verify mdev open browser action"
```

If no tracked files changed, do not create an empty commit.

## Plan Self-Review

- Spec coverage: Tasks 1 and 5 implement the pane-context command and `mdev open auto/pick` execution. Tasks 2 and 3 replace the modal `App` row with `Open` and `Pick`. Task 4 removes `OPEN_HOST_URL_APP` from the visible bundled browser keyboard and adds direct action IDs. Task 6 verifies config and tests.
- Placeholder scan: The plan contains concrete paths, code snippets, commands, and expected outcomes for each task.
- Type consistency: `HostBrowserOpenMode` is defined in Task 1 and reused in Task 5. Detected-open intent names are introduced in Task 2 and handled in Task 3. Runtime action IDs introduced in Task 4 are wired from `detail.tsx` in Task 5.
