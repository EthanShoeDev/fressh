# Browser Key Long-Press Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a long-press browser action popup to the main `Browser` key while keeping its short-tap `OPEN_BROWSER_KEYBOARD` action unchanged.

**Architecture:** This is a runtime shell config change centered on `apps/mobile/config/shell-config.json`. The `phone_base` Browser slot remains an action slot, gains `longPress.options`, and existing integration tests are updated to lock the config contract; no runtime code, schema, generated files, or keyboard routing changes are needed.

**Tech Stack:** Expo React Native app, runtime shell config JSON, Node `node:test` integration tests, pnpm workspace filters.

---

## File Structure

- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
  - Owns bundled keyboard config assertions.
  - Update the existing Browser key assertion so it expects the long-press action popup.

- Modify: `apps/mobile/config/shell-config.json`
  - Source of truth for the runtime keyboard config.
  - Add `longPress.options` to `phone_base.grid[0][1]`, the existing `Browser` action key.
  - Bump config metadata with the existing script after editing.

- Do not modify: `apps/mobile/src/lib/keyboard-actions.ts`
  - Existing action IDs are sufficient.

- Do not modify: generated keyboard files under `apps/mobile/src/generated`.

## Task 1: Update Browser Key Config Test First

**Files:**
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Update the test name**

In `apps/mobile/test/integration/keyboard-config.test.ts`, change:

```ts
void test('phone base keyboard exposes explain, browser and status actions', () => {
```

to:

```ts
void test('phone base keyboard exposes explain, browser long press, and status actions', () => {
```

- [ ] **Step 2: Replace the Browser key assertion**

In that same test, replace the current Browser assertion:

```ts
	assert.deepEqual(phoneBaseKeyboard.grid[0]?.[1], {
		type: 'action',
		actionId: 'OPEN_BROWSER_KEYBOARD',
		label: 'Browser',
		icon: 'ExternalLink',
	});
```

with:

```ts
	assert.deepEqual(phoneBaseKeyboard.grid[0]?.[1], {
		type: 'action',
		actionId: 'OPEN_BROWSER_KEYBOARD',
		label: 'Browser',
		icon: 'ExternalLink',
		longPress: {
			options: [
				{
					type: 'action',
					actionId: 'OPEN_BROWSER_KEYBOARD',
					label: 'Browser',
					icon: 'ExternalLink',
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
					actionId: 'OPEN_HOST_URL_APP',
					label: 'App',
					icon: 'PanelTop',
				},
			],
		},
	});
```

This uses the same labels and icons as the current `browser_keyboard` row.

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: FAIL. The failure shows `phoneBaseKeyboard.grid[0]?.[1]` does not yet
include `longPress.options`.

- [ ] **Step 4: Leave the failing test uncommitted**

Do not commit yet. Keep the failing test in the worktree so Task 2 can make it
pass and commit a green config-plus-test change.

## Task 2: Add Browser Long-Press Options To Runtime Config

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Include existing test change in commit: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Update the Browser action slot**

In `apps/mobile/config/shell-config.json`, find the `phone_base` top-row
Browser key:

```json
{
  "type": "action",
  "actionId": "OPEN_BROWSER_KEYBOARD",
  "label": "Browser",
  "icon": "ExternalLink"
}
```

Replace it with:

```json
{
  "type": "action",
  "actionId": "OPEN_BROWSER_KEYBOARD",
  "label": "Browser",
  "icon": "ExternalLink",
  "longPress": {
    "options": [
      {
        "type": "action",
        "actionId": "OPEN_BROWSER_KEYBOARD",
        "label": "Browser",
        "icon": "ExternalLink"
      },
      {
        "type": "action",
        "actionId": "OPEN_HOST_DIFFITY",
        "label": "Diff",
        "icon": "GitCompare"
      },
      {
        "type": "action",
        "actionId": "OPEN_HOST_URL_WINDOW",
        "label": "URL",
        "icon": "Link"
      },
      {
        "type": "action",
        "actionId": "OPEN_HOST_URL_DEV_SERVER",
        "label": "Web",
        "icon": "Globe"
      },
      {
        "type": "action",
        "actionId": "OPEN_HOST_URL_STORYBOOK",
        "label": "Story",
        "icon": "BookOpen"
      },
      {
        "type": "action",
        "actionId": "OPEN_HOST_URL_APP",
        "label": "App",
        "icon": "PanelTop"
      }
    ]
  }
}
```

- [ ] **Step 2: Bump runtime config metadata**

Run:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/bump-shell-config-metadata.mjs
```

Expected: the `apps/mobile/config/shell-config.json` `version` and `updatedAt`
metadata change.

- [ ] **Step 3: Summarize the keyboard config**

Run:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/summarize-keyboards.mjs
```

Expected: `phone_base` row 1 still shows `Browser:action action=OPEN_BROWSER_KEYBOARD`
and now includes `longPress=6`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Validate the keyboard config**

Run:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
```

Expected: PASS.

- [ ] **Step 6: Commit the passing config and test change**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "chore(mobile): add browser key long press actions"
```

## Task 3: Verify Scope And Publish Runtime Config

**Files:**
- Inspect: `apps/mobile/config/shell-config.json`
- Inspect: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Inspect the scoped diff**

Run:

```bash
git diff --stat HEAD~1..HEAD
git diff HEAD~1..HEAD -- apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
```

Expected:

- only `apps/mobile/config/shell-config.json` and
  `apps/mobile/test/integration/keyboard-config.test.ts` changed in the
  implementation commit
- `Browser` short tap remains `type: "action"` with
  `actionId: "OPEN_BROWSER_KEYBOARD"`
- `Browser` long press has exactly six action options:
  `OPEN_BROWSER_KEYBOARD`, `OPEN_HOST_DIFFITY`, `OPEN_HOST_URL_WINDOW`,
  `OPEN_HOST_URL_DEV_SERVER`, `OPEN_HOST_URL_STORYBOOK`, `OPEN_HOST_URL_APP`
- no `alt_w` macro is added to the Browser key

- [ ] **Step 2: Run the full mobile integration test suite**

Run:

```bash
pnpm --filter @fressh/mobile test:integration
```

Expected: PASS.

- [ ] **Step 3: Run the mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Confirm the branch is `dev`**

Run:

```bash
git branch --show-current
```

Expected: `dev`.

- [ ] **Step 5: Push runtime config delivery branch**

Run:

```bash
git push origin dev
```

Expected: push succeeds. The app fetches runtime shell config JSON from the
remote `dev` branch; no OTA update is needed for this JSON-only keyboard config
change.

## Final Handoff

Report:

- Browser key short-tap behavior remains `OPEN_BROWSER_KEYBOARD`.
- Browser key long-press options added: Browser, Diff, URL, Web, Story, App.
- New config `version` and `updatedAt`.
- Validation commands run and results.
- Commit and push status.
- Device step: open the shell Configure modal and tap `Reload config`.
