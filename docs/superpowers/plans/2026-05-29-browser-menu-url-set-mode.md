# Browser Menu URL Set Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Browser menu Open/Set mode toggle so URL slot rows can either open saved URLs or edit them from the same menu, while removing the old Advanced keyboard URL setter keys.

**Architecture:** Keep `BrowserActionsModal` as the UI owner for menu-local mode state. Add a small pure routing helper in `browser-actions.ts` so mode-dependent row behavior is covered by plain integration tests, then have the modal call the existing open/edit callbacks from that helper. Update only the bundled runtime keyboard config to remove the duplicate setter keys; keep legacy action IDs and `browser_keyboard` routing intact.

**Tech Stack:** Expo React Native, TypeScript, `node:test` via `tsx`, bundled JSON shell config validation.

---

## File Structure

- Modify `apps/mobile/src/lib/browser-actions.ts`
  - Owns Browser action row data and pure action intent mapping.
  - Add `BrowserActionMenuMode`, `BrowserActionPressIntent`, and `getBrowserActionPressIntent(row, mode)`.
- Modify `apps/mobile/test/integration/browser-actions.test.ts`
  - Covers approved Browser row order and mode-dependent URL/static row routing.
- Modify `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
  - Owns Open/Set menu-local UI state.
  - Renders the compact mode toggle in the modal header.
  - Uses the pure helper to dispatch row taps to existing callbacks.
- Modify `apps/mobile/config/shell-config.json`
  - Bump metadata.
  - Replace Advanced keyboard `Set URL`, `Set Web`, `Set Story`, and `Set App` cells with `null`.
  - Leave `browser_keyboard` and `OPEN_BROWSER_KEYBOARD` untouched.
- Modify `apps/mobile/test/integration/keyboard-config.test.ts`
  - Update the Advanced keyboard assertion so the removed setter cells are expected to be empty.
  - Verify the legacy setter action IDs no longer appear in the Advanced keyboard config.

---

### Task 1: Add Pure Browser Action Mode Routing

**Files:**
- Modify: `apps/mobile/test/integration/browser-actions.test.ts`
- Modify: `apps/mobile/src/lib/browser-actions.ts`

- [ ] **Step 1: Write the failing mode-routing tests**

Replace `apps/mobile/test/integration/browser-actions.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_ACTION_ROWS,
	BROWSER_ACTION_URL_ROWS,
	getBrowserActionPressIntent,
	isBrowserActionUrlRow,
	type BrowserActionMenuMode,
} from '../../src/lib/browser-actions';

void test('browser action rows expose the approved order and URL editability', () => {
	assert.deepEqual(
		BROWSER_ACTION_ROWS.map((row) => row.id),
		[
			'diff',
			'github-issues',
			'github-pulls',
			'url-window',
			'url-dev-server',
			'url-storybook',
			'url-app',
		],
	);

	assert.deepEqual(
		BROWSER_ACTION_URL_ROWS.map((row) => row.slot),
		['window-url', 'dev-web-server-url', 'storybook-url', 'app-url'],
	);

	assert.equal(isBrowserActionUrlRow(BROWSER_ACTION_ROWS[0]!), false);
	assert.equal(isBrowserActionUrlRow(BROWSER_ACTION_ROWS[3]!), true);
});

void test('browser action press intent keeps static rows as open actions in every mode', () => {
	const modes: readonly BrowserActionMenuMode[] = ['open', 'set'];

	for (const mode of modes) {
		assert.deepEqual(
			getBrowserActionPressIntent(BROWSER_ACTION_ROWS[0]!, mode),
			{ type: 'open-diff' },
		);
		assert.deepEqual(
			getBrowserActionPressIntent(BROWSER_ACTION_ROWS[1]!, mode),
			{ type: 'open-github-issues' },
		);
		assert.deepEqual(
			getBrowserActionPressIntent(BROWSER_ACTION_ROWS[2]!, mode),
			{ type: 'open-github-pulls' },
		);
	}
});

void test('browser action press intent opens URL slots in open mode', () => {
	assert.deepEqual(
		BROWSER_ACTION_URL_ROWS.map((row) =>
			getBrowserActionPressIntent(row, 'open'),
		),
		[
			{ type: 'open-url-slot', slot: 'window-url' },
			{ type: 'open-url-slot', slot: 'dev-web-server-url' },
			{ type: 'open-url-slot', slot: 'storybook-url' },
			{ type: 'open-url-slot', slot: 'app-url' },
		],
	);
});

void test('browser action press intent edits URL slots in set mode', () => {
	assert.deepEqual(
		BROWSER_ACTION_URL_ROWS.map((row) =>
			getBrowserActionPressIntent(row, 'set'),
		),
		[
			{ type: 'edit-url-slot', slot: 'window-url' },
			{ type: 'edit-url-slot', slot: 'dev-web-server-url' },
			{ type: 'edit-url-slot', slot: 'storybook-url' },
			{ type: 'edit-url-slot', slot: 'app-url' },
		],
	);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-actions.test.ts
```

Expected: FAIL with a TypeScript/runtime import error because `getBrowserActionPressIntent` and `BrowserActionMenuMode` are not exported from `../../src/lib/browser-actions`.

- [ ] **Step 3: Add the pure mode-routing helper**

In `apps/mobile/src/lib/browser-actions.ts`, add these exports after `BrowserActionRow` and before `BROWSER_ACTION_ROWS`:

```ts
export type BrowserActionMenuMode = 'open' | 'set';

export type BrowserActionPressIntent =
	| { type: 'open-diff' }
	| { type: 'open-github-issues' }
	| { type: 'open-github-pulls' }
	| { type: 'open-url-slot'; slot: HostBrowserUrlSlot }
	| { type: 'edit-url-slot'; slot: HostBrowserUrlSlot };
```

Then add this function after `isBrowserActionUrlRow`:

```ts
export function getBrowserActionPressIntent(
	row: BrowserActionRow,
	mode: BrowserActionMenuMode,
): BrowserActionPressIntent {
	if (isBrowserActionUrlRow(row)) {
		return mode === 'set'
			? { type: 'edit-url-slot', slot: row.slot }
			: { type: 'open-url-slot', slot: row.slot };
	}

	switch (row.id) {
		case 'diff':
			return { type: 'open-diff' };
		case 'github-issues':
			return { type: 'open-github-issues' };
		case 'github-pulls':
			return { type: 'open-github-pulls' };
	}

	const exhaustive: never = row;
	return exhaustive;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-actions.test.ts
```

Expected: PASS with 4 passing subtests.

- [ ] **Step 5: Commit the routing helper**

Run:

```bash
git add apps/mobile/src/lib/browser-actions.ts apps/mobile/test/integration/browser-actions.test.ts
git commit -m "test(mobile): cover browser action set mode routing"
```

Expected: commit succeeds with only those two files staged.

---

### Task 2: Add the Browser Menu Open/Set Toggle

**Files:**
- Modify: `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
- Test: `apps/mobile/test/integration/browser-actions.test.ts`

- [ ] **Step 1: Update the modal implementation**

Replace `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx` with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	BROWSER_ACTION_ROWS,
	getBrowserActionPressIntent,
	isBrowserActionUrlRow,
	type BrowserActionMenuMode,
	type BrowserActionRow,
} from '@/lib/browser-actions';
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { useTheme } from '@/lib/theme';

export function BrowserActionsModal({
	open,
	bottomOffset,
	onClose,
	onOpenDiff,
	onOpenGitHubIssues,
	onOpenGitHubPulls,
	onOpenUrlSlot,
	onEditUrlSlot,
}: {
	open: boolean;
	bottomOffset: number;
	onClose: () => void;
	onOpenDiff: () => void;
	onOpenGitHubIssues: () => void;
	onOpenGitHubPulls: () => void;
	onOpenUrlSlot: (slot: HostBrowserUrlSlot) => void;
	onEditUrlSlot: (slot: HostBrowserUrlSlot) => void;
}) {
	const theme = useTheme();
	const longPressedRowIdRef = useRef<string | null>(null);
	const [menuMode, setMenuMode] = useState<BrowserActionMenuMode>('open');

	useEffect(() => {
		longPressedRowIdRef.current = null;
		if (open) {
			setMenuMode('open');
		}
	}, [open]);

	const runAndClose = useCallback(
		(callback: () => void) => {
			onClose();
			callback();
		},
		[onClose],
	);

	const handlePress = useCallback(
		(row: BrowserActionRow) => {
			if (longPressedRowIdRef.current === row.id) {
				longPressedRowIdRef.current = null;
				return;
			}

			const intent = getBrowserActionPressIntent(row, menuMode);
			switch (intent.type) {
				case 'open-diff':
					runAndClose(onOpenDiff);
					return;
				case 'open-github-issues':
					runAndClose(onOpenGitHubIssues);
					return;
				case 'open-github-pulls':
					runAndClose(onOpenGitHubPulls);
					return;
				case 'open-url-slot':
					runAndClose(() => onOpenUrlSlot(intent.slot));
					return;
				case 'edit-url-slot':
					runAndClose(() => onEditUrlSlot(intent.slot));
					return;
			}
		},
		[
			menuMode,
			onEditUrlSlot,
			onOpenDiff,
			onOpenGitHubIssues,
			onOpenGitHubPulls,
			onOpenUrlSlot,
			runAndClose,
		],
	);

	const handleLongPress = useCallback(
		(row: BrowserActionRow) => {
			if (!isBrowserActionUrlRow(row)) return;
			longPressedRowIdRef.current = row.id;
			runAndClose(() => onEditUrlSlot(row.slot));
		},
		[onEditUrlSlot, runAndClose],
	);

	const toggleMenuMode = useCallback(() => {
		setMenuMode((current) => (current === 'open' ? 'set' : 'open'));
	}, []);

	const modeButtonLabel = menuMode === 'open' ? 'Set' : 'Open';

	return (
		<Modal
			transparent
			visible={open}
			animationType="slide"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
					justifyContent: 'flex-end',
					alignItems: 'flex-end',
				}}
			>
				<View
					onStartShouldSetResponder={() => true}
					style={{
						backgroundColor: theme.colors.background,
						borderTopLeftRadius: 16,
						padding: 16,
						borderColor: theme.colors.borderStrong,
						borderWidth: 1,
						maxHeight: '80%',
						width: '72%',
						maxWidth: 360,
						minWidth: 260,
						marginRight: 8,
						marginBottom: bottomOffset,
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginBottom: 12,
						}}
					>
						<Text
							style={{
								color: theme.colors.textPrimary,
								fontSize: 18,
								fontWeight: '700',
							}}
						>
							Browser
						</Text>
						<View
							style={{
								flexDirection: 'row',
								alignItems: 'center',
							}}
						>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Switch Browser menu to ${modeButtonLabel} mode`}
								onPress={toggleMenuMode}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor:
										menuMode === 'set'
											? theme.colors.primary
											: theme.colors.border,
									backgroundColor:
										menuMode === 'set'
											? theme.colors.primaryDisabled
											: theme.colors.background,
									marginRight: 8,
								}}
							>
								<Text style={{ color: theme.colors.textPrimary }}>
									{modeButtonLabel}
								</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								onPress={onClose}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>Close</Text>
							</Pressable>
						</View>
					</View>

					<ScrollView>
						{BROWSER_ACTION_ROWS.map((row) => {
							const Icon = resolveLucideIcon(row.icon);
							return (
								<Pressable
									key={row.id}
									accessibilityRole="button"
									onPress={() => handlePress(row)}
									onLongPress={
										isBrowserActionUrlRow(row)
											? () => handleLongPress(row)
											: undefined
									}
									style={{
										paddingVertical: 12,
										paddingHorizontal: 12,
										borderRadius: 10,
										borderWidth: 1,
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.surface,
										marginBottom: 8,
									}}
								>
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
										}}
									>
										{Icon ? (
											<View style={{ marginRight: 10 }}>
												<Icon color={theme.colors.textPrimary} size={18} />
											</View>
										) : null}
										<View style={{ flex: 1 }}>
											<Text
												style={{
													color: theme.colors.textPrimary,
													fontSize: 14,
													fontWeight: '600',
												}}
											>
												{row.label}
											</Text>
											<Text
												numberOfLines={2}
												style={{
													color: theme.colors.textSecondary,
													fontSize: 12,
													marginTop: 2,
												}}
											>
												{row.description}
											</Text>
										</View>
									</View>
								</Pressable>
							);
						})}
					</ScrollView>
				</View>
			</Pressable>
		</Modal>
	);
}
```

- [ ] **Step 2: Run focused tests for the modal routing dependency**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-actions.test.ts
```

Expected: PASS with 4 passing subtests.

- [ ] **Step 3: Run typecheck for the component change**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit the modal toggle**

Run:

```bash
git add apps/mobile/src/app/shell/components/BrowserActionsModal.tsx
git commit -m "feat(mobile): add browser menu URL set mode"
```

Expected: commit succeeds with only the modal file staged.

---

### Task 3: Remove Advanced Keyboard URL Setter Keys

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Write the failing keyboard config test**

In `apps/mobile/test/integration/keyboard-config.test.ts`, replace the test named `advanced keyboard exposes host URL setter actions` with:

```ts
void test('advanced keyboard omits consolidated host URL setter actions', () => {
	const config = getBundledShellConfig();
	const advancedKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'advanced_keyboard',
	);
	assert.ok(advancedKeyboard);

	assert.equal(advancedKeyboard.grid.length, 3);
	assert.deepEqual(advancedKeyboard.grid[0]?.slice(4, 5), [
		{
			type: 'action',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
			label: 'Issue',
			icon: 'CirclePlus',
		},
	]);
	assert.deepEqual(advancedKeyboard.grid[2]?.slice(0, 4), [
		null,
		null,
		null,
		null,
	]);

	const advancedActionIds = advancedKeyboard.grid.flatMap((row) =>
		row.flatMap((item) => (item?.type === 'action' ? [item.actionId] : [])),
	);

	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_WINDOW'), false);
	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_DEV_SERVER'), false);
	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_STORYBOOK'), false);
	assert.equal(advancedActionIds.includes('EDIT_HOST_URL_APP'), false);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: FAIL because `advancedKeyboard.grid[2]?.slice(0, 4)` still contains `Set URL`, `Set Web`, `Set Story`, and `Set App` action cells.

- [ ] **Step 3: Update the bundled shell config**

In `apps/mobile/config/shell-config.json`, update the metadata at the top:

```json
{
	"version": "2026-05-29.2",
	"updatedAt": "2026-05-29T08:15:00Z",
```

In the `advanced_keyboard` third grid row, replace the first four setter action cells with `null` values so the row begins exactly like this:

```json
[
	null,
	null,
	null,
	null,
	null,
	null,
	null,
	{
		"type": "bytes",
		"bytes": [27, 91, 49, 59, 55, 68],
		"label": "Prev all",
		"icon": null
	},
	{
		"type": "bytes",
		"bytes": [27, 91, 49, 59, 55, 67],
		"label": "Next all",
		"icon": null
	},
	null
]
```

Do not edit `keyboardRouting.actionTargets.OPEN_BROWSER_KEYBOARD`, `activeKeyboardIds`, or the `browser_keyboard` object.

- [ ] **Step 4: Validate the config and tests**

Run:

```bash
cd apps/mobile && pnpm run validate:shell-config
```

Expected: PASS and prints `Valid shell config 2026-05-29.2 (2026-05-29T08:15:00Z)`.

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the config cleanup**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "fix(mobile): consolidate URL setters into browser menu"
```

Expected: commit succeeds with only the config and keyboard config test staged.

---

### Task 4: Final Verification and Preview Delivery

**Files:**
- Verify: `apps/mobile/src/lib/browser-actions.ts`
- Verify: `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
- Verify: `apps/mobile/config/shell-config.json`
- Verify: `apps/mobile/test/integration/browser-actions.test.ts`
- Verify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Run focused integration tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-actions.test.ts test/integration/keyboard-config.test.ts test/integration/keyboard-actions.test.ts
```

Expected: PASS for Browser action routing, keyboard config, and legacy keyboard action dispatch. `keyboard-actions.test.ts` confirms `EDIT_HOST_URL_*` action IDs still delegate correctly even though their Advanced keyboard cells were removed.

- [ ] **Step 2: Run shell config validation**

Run:

```bash
cd apps/mobile && pnpm run validate:shell-config
```

Expected: PASS and prints `Valid shell config 2026-05-29.2 (2026-05-29T08:15:00Z)`.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @fressh/mobile typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run targeted lint on touched TypeScript files**

Run:

```bash
cd apps/mobile && pnpm exec eslint --max-warnings 0 --report-unused-disable-directives src/lib/browser-actions.ts src/app/shell/components/BrowserActionsModal.tsx test/integration/browser-actions.test.ts test/integration/keyboard-config.test.ts
```

Expected: PASS with no ESLint warnings.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git status --short
```

Expected: the diff includes only the five planned files. `git status --short` may show the existing untracked `.superpowers/` directory; leave it untracked.

- [ ] **Step 6: Push and publish preview OTA**

Run:

```bash
git push origin dev
cd apps/mobile && pnpm exec eas update --channel preview --message "Add Browser URL set mode"
```

Expected: `git push` succeeds. `eas update` exits 0 and prints an update group ID plus Android update ID for the preview channel.

- [ ] **Step 7: Manual Android verification**

Run:

```bash
adb connect 100.113.210.6:5555
adb devices | rg '100\\.113\\.210\\.6'
```

Expected: the device appears as `device`.

On the Android device:

1. Open the app after the preview update is available.
2. Tap `Browser`; the Browser action menu opens in Open mode with a `Set` button in the header.
3. Tap a saved `URL`, `Web`, `Story`, or `App` row; Android opens the saved URL.
4. Tap an unset URL slot in Open mode; the set modal appears and saving opens the URL.
5. Reopen `Browser`, tap `Set`, then tap each URL slot; the edit modal appears.
6. Save from Set mode; the saved URL does not automatically open.
7. In Set mode, tap `Diff`, `GitHub Issues`, and `GitHub Pull Requests`; each still opens the correct Android URL.
8. Open the Advanced keyboard and confirm `Set URL`, `Set Web`, `Set Story`, and `Set App` are absent.

- [ ] **Step 8: Commit no additional files**

Run:

```bash
git status --short
```

Expected: no tracked files are modified. The existing untracked `.superpowers/` directory remains untouched.
