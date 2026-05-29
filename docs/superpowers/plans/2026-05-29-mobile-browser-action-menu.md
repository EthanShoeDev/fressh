# Mobile Browser Action Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile `Browser` key open a compact browser action menu that includes Diffity, GitHub Issues, GitHub Pull Requests, and URL open/edit actions.

**Architecture:** Add one new runtime keyboard action, `OPEN_BROWSER_ACTIONS`, that opens a dedicated `BrowserActionsModal`. Keep Android URL opening in `detail.tsx`, reuse existing host URL and repository-resolution helpers, and update the runtime shell config so the main `Browser` key points at the new action.

**Tech Stack:** Expo React Native, TypeScript, React Native `Modal`/`Pressable`, Node `tsx --test`, runtime shell config JSON, existing side-channel SSH command helpers.

---

## File Structure

- Modify `apps/mobile/src/lib/repo-feature-request.ts`: add typed GitHub target URL helpers beside existing repository parsing and resolution helpers.
- Modify `apps/mobile/test/integration/repo-feature-request.test.ts`: cover Issues/Pulls URL construction and target rejection.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`: add `OPEN_BROWSER_ACTIONS` and delegate it through `ActionContext.openBrowserActions`.
- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`: cover the new action dispatch.
- Create `apps/mobile/src/lib/browser-actions.ts`: define the Browser menu row model, labels, and URL slot mapping for a focused testable boundary.
- Create `apps/mobile/test/integration/browser-actions.test.ts`: verify row order, GitHub rows, URL slot rows, and non-editable rows.
- Create `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`: present the compact bottom-right action menu and route tap/long-press row gestures.
- Modify `apps/mobile/src/app/shell/detail.tsx`: own Browser menu state, wire modal callbacks, add GitHub open handlers, and pass `openBrowserActions` into the keyboard action context.
- Modify `apps/mobile/config/shell-config.json`: change the main `Browser` key to `OPEN_BROWSER_ACTIONS` and remove its long-press menu.
- Update generated config metadata only through `.agents/skills/modify-mobile-keyboard/scripts/bump-shell-config-metadata.mjs`.

## Task 1: GitHub Target URL Helpers

**Files:**
- Modify: `apps/mobile/src/lib/repo-feature-request.ts`
- Modify: `apps/mobile/test/integration/repo-feature-request.test.ts`

- [ ] **Step 1: Write failing tests for GitHub target URL helpers**

Append this test to `apps/mobile/test/integration/repo-feature-request.test.ts` and add the two new imports to the existing import list.

```ts
import {
	buildCreateGitHubIssueCommand,
	buildGitHubRepositoryTargetUrl,
	buildResolveGitHubRepositoryCommand,
	isGitHubRepositoryTarget,
	parseGitHubRepositoryRemoteUrl,
	parseGitHubRepositoryResolutionOutput,
} from '../../src/lib/repo-feature-request';
```

```ts
void test('GitHub repository target helpers build Issues and Pull Requests URLs', () => {
	assert.equal(isGitHubRepositoryTarget('issues'), true);
	assert.equal(isGitHubRepositoryTarget('pulls'), true);
	assert.equal(isGitHubRepositoryTarget('repo'), false);

	assert.equal(
		buildGitHubRepositoryTargetUrl('mulyoved/fressh', 'issues'),
		'https://github.com/mulyoved/fressh/issues',
	);
	assert.equal(
		buildGitHubRepositoryTargetUrl('mulyoved/fressh', 'pulls'),
		'https://github.com/mulyoved/fressh/pulls',
	);
	assert.throws(
		() => buildGitHubRepositoryTargetUrl('not a repo', 'issues'),
		/Invalid GitHub repository/,
	);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/repo-feature-request.test.ts
```

Expected: FAIL with TypeScript/runtime import errors for `buildGitHubRepositoryTargetUrl` and `isGitHubRepositoryTarget`.

- [ ] **Step 3: Implement the GitHub target helpers**

In `apps/mobile/src/lib/repo-feature-request.ts`, add this after `parseGitHubRepositoryResolutionOutput`.

```ts
export const GITHUB_REPOSITORY_TARGETS = ['issues', 'pulls'] as const;

export type GitHubRepositoryTarget =
	(typeof GITHUB_REPOSITORY_TARGETS)[number];

export function isGitHubRepositoryTarget(
	value: string,
): value is GitHubRepositoryTarget {
	return GITHUB_REPOSITORY_TARGETS.includes(
		value as GitHubRepositoryTarget,
	);
}

export function buildGitHubRepositoryTargetUrl(
	repository: string,
	target: GitHubRepositoryTarget,
): string {
	if (!githubRepositoryPattern.test(repository)) {
		throw new Error(`Invalid GitHub repository: ${repository}`);
	}
	return `https://github.com/${repository}/${target}`;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/repo-feature-request.test.ts
```

Expected: PASS for all tests in `repo-feature-request.test.ts`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts
git commit -m "feat(mobile): add github browser URL helpers"
```

## Task 2: Runtime Keyboard Action

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Write the failing keyboard action dispatch test**

Append this test to `apps/mobile/test/integration/keyboard-actions.test.ts`.

```ts
void test('browser actions menu action delegates to the action context', async () => {
	let opened = 0;

	await runAction('OPEN_BROWSER_ACTIONS', {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openBrowserActions: () => {
			opened += 1;
		},
	} as Parameters<typeof runAction>[1]);

	assert.equal(opened, 1);
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_BROWSER_ACTIONS'), true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: FAIL because `OPEN_BROWSER_ACTIONS` is not handled and `openBrowserActions` is not part of `ActionContext`.

- [ ] **Step 3: Add the runtime action ID and context callback**

In `apps/mobile/src/lib/keyboard-actions.ts`, add `OPEN_BROWSER_ACTIONS` to `KNOWN_ACTION_IDS` immediately after `OPEN_SKILL_SELECTOR`.

```ts
	'OPEN_SKILL_SELECTOR',
	'OPEN_BROWSER_ACTIONS',
	'OPEN_REPO_FEATURE_REQUEST',
```

Add the callback to `ActionContext` immediately after `openSkillSelector`.

```ts
	openSkillSelector?: () => void;
	openBrowserActions?: () => void;
	openRepoFeatureRequest?: () => void;
```

Add this switch case immediately after the `OPEN_SKILL_SELECTOR` case.

```ts
		case 'OPEN_BROWSER_ACTIONS': {
			context.openBrowserActions?.();
			return;
		}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: PASS for all tests in `keyboard-actions.test.ts`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts
git commit -m "feat(mobile): add browser actions keyboard action"
```

## Task 3: Browser Menu Row Model

**Files:**
- Create: `apps/mobile/src/lib/browser-actions.ts`
- Create: `apps/mobile/test/integration/browser-actions.test.ts`

- [ ] **Step 1: Write the failing row model test**

Create `apps/mobile/test/integration/browser-actions.test.ts` with this content.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_ACTION_ROWS,
	BROWSER_ACTION_URL_ROWS,
	isBrowserActionUrlRow,
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-actions.test.ts
```

Expected: FAIL because `../../src/lib/browser-actions` does not exist.

- [ ] **Step 3: Create the row model**

Create `apps/mobile/src/lib/browser-actions.ts` with this content.

```ts
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';

export type BrowserActionStaticRowId =
	| 'diff'
	| 'github-issues'
	| 'github-pulls';

export type BrowserActionUrlRowId =
	| 'url-window'
	| 'url-dev-server'
	| 'url-storybook'
	| 'url-app';

export type BrowserActionRow =
	| {
			id: BrowserActionStaticRowId;
			type: 'static';
			label: string;
			description: string;
			icon: string;
	  }
	| {
			id: BrowserActionUrlRowId;
			type: 'url-slot';
			label: string;
			description: string;
			icon: string;
			slot: HostBrowserUrlSlot;
	  };

export const BROWSER_ACTION_ROWS = [
	{
		id: 'diff',
		type: 'static',
		label: 'Diff',
		description: 'Open Diffity for this repository',
		icon: 'GitCompare',
	},
	{
		id: 'github-issues',
		type: 'static',
		label: 'GitHub Issues',
		description: 'Open repository issues',
		icon: 'CircleDot',
	},
	{
		id: 'github-pulls',
		type: 'static',
		label: 'GitHub Pull Requests',
		description: 'Open repository pull requests',
		icon: 'GitPullRequest',
	},
	{
		id: 'url-window',
		type: 'url-slot',
		label: 'URL',
		description: 'Open or set the saved generic URL',
		icon: 'Link',
		slot: 'window-url',
	},
	{
		id: 'url-dev-server',
		type: 'url-slot',
		label: 'Web',
		description: 'Open or set the saved dev server URL',
		icon: 'Globe',
		slot: 'dev-web-server-url',
	},
	{
		id: 'url-storybook',
		type: 'url-slot',
		label: 'Story',
		description: 'Open or set the saved Storybook URL',
		icon: 'BookOpen',
		slot: 'storybook-url',
	},
	{
		id: 'url-app',
		type: 'url-slot',
		label: 'App',
		description: 'Open or set the saved app URL',
		icon: 'PanelTop',
		slot: 'app-url',
	},
] as const satisfies readonly BrowserActionRow[];

export const BROWSER_ACTION_URL_ROWS = BROWSER_ACTION_ROWS.filter(
	isBrowserActionUrlRow,
);

export function isBrowserActionUrlRow(
	row: BrowserActionRow,
): row is Extract<BrowserActionRow, { type: 'url-slot' }> {
	return row.type === 'url-slot';
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/browser-actions.test.ts
```

Expected: PASS for `browser-actions.test.ts`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/mobile/src/lib/browser-actions.ts apps/mobile/test/integration/browser-actions.test.ts
git commit -m "feat(mobile): define browser action rows"
```

## Task 4: Browser Actions Modal

**Files:**
- Create: `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx` with this content.

```tsx
import React, { useCallback, useRef } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
	BROWSER_ACTION_ROWS,
	isBrowserActionUrlRow,
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
			if (row.id === 'diff') {
				runAndClose(onOpenDiff);
				return;
			}
			if (row.id === 'github-issues') {
				runAndClose(onOpenGitHubIssues);
				return;
			}
			if (row.id === 'github-pulls') {
				runAndClose(onOpenGitHubPulls);
				return;
			}
			if (isBrowserActionUrlRow(row)) {
				runAndClose(() => onOpenUrlSlot(row.slot));
			}
		},
		[
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

					<ScrollView>
						{BROWSER_ACTION_ROWS.map((row) => {
							const Icon = resolveLucideIcon(row.icon);
							return (
								<Pressable
									key={row.id}
									accessibilityRole="button"
									onPress={() => handlePress(row)}
									onLongPress={() => handleLongPress(row)}
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

- [ ] **Step 2: Run typecheck and fix import/style issues inside the new file**

Run:

```bash
cd apps/mobile && pnpm run typecheck
```

Expected: PASS. If it fails for a missing icon type or style prop type, change only `BrowserActionsModal.tsx` and rerun the same command until it passes.

- [ ] **Step 3: Commit**

Run:

```bash
git add apps/mobile/src/app/shell/components/BrowserActionsModal.tsx
git commit -m "feat(mobile): add browser actions modal"
```

## Task 5: Detail Screen Wiring

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Import the modal and GitHub helpers**

In `apps/mobile/src/app/shell/detail.tsx`, add `BrowserActionsModal` with the other local component imports.

```ts
import { BrowserActionsModal } from './components/BrowserActionsModal';
```

Update the `repo-feature-request` import to include the URL helper and target type.

```ts
import {
	buildCreateGitHubIssueCommand,
	buildGitHubRepositoryTargetUrl,
	buildResolveGitHubRepositoryCommand,
	parseGitHubRepositoryResolutionOutput,
	type GitHubRepositoryTarget,
} from '@/lib/repo-feature-request';
```

- [ ] **Step 2: Add Browser menu state**

After `const [commandPresetsOpen, setCommandPresetsOpen] = useState(false);`, add:

```ts
	const [browserActionsOpen, setBrowserActionsOpen] = useState(false);
```

- [ ] **Step 3: Add open/close and GitHub handlers**

Add this block after `handleOpenHostDiffity` and before `handleOpenHostUrlSlot`.

```ts
	const handleOpenBrowserActions = useCallback(() => {
		invalidateHostUrlReads();
		setCommandPresetsOpen(false);
		setCommanderOpen(false);
		closeSkillSelector();
		handleCloseTextEntry();
		setConfigureOpen(false);
		setFeatureRequestOpen(false);
		setFeatureRequestError(undefined);
		setHostUrlModalState(null);
		setHostUrlModalError(null);
		setBrowserActionsOpen(true);
	}, [closeSkillSelector, handleCloseTextEntry, invalidateHostUrlReads]);

	const handleCloseBrowserActions = useCallback(() => {
		setBrowserActionsOpen(false);
	}, []);

	const handleOpenGitHubTarget = useCallback(
		(target: GitHubRepositoryTarget) => {
			const title =
				target === 'issues'
					? 'GitHub Issues failed'
					: 'GitHub Pull Requests failed';
			void (async () => {
				try {
					const panePath = await resolveHostBrowserPanePath();
					const output = await runHostBrowserCommand(
						buildResolveGitHubRepositoryCommand(panePath),
						10_000,
					);
					const repository = parseGitHubRepositoryResolutionOutput(output);
					if (!repository) {
						throw new Error(
							'Could not resolve GitHub repository for current window.',
						);
					}
					await openAndroidUrl(
						buildGitHubRepositoryTargetUrl(repository, target),
					);
				} catch (error) {
					showHostBrowserError(title, getErrorMessage(error));
				}
			})();
		},
		[
			openAndroidUrl,
			resolveHostBrowserPanePath,
			runHostBrowserCommand,
			showHostBrowserError,
		],
	);

	const handleOpenGitHubIssuesTarget = useCallback(() => {
		handleOpenGitHubTarget('issues');
	}, [handleOpenGitHubTarget]);

	const handleOpenGitHubPullsTarget = useCallback(() => {
		handleOpenGitHubTarget('pulls');
	}, [handleOpenGitHubTarget]);
```

- [ ] **Step 4: Close the Browser menu from sibling modal actions**

Inside `handleOpenSkillSelector`, add `setBrowserActionsOpen(false);` next to the existing modal close calls.

```ts
		setBrowserActionsOpen(false);
```

Inside `toggleCommandPresets`, add `setBrowserActionsOpen(false);` before `setCommandPresetsOpen((prev) => !prev);`.

```ts
				setBrowserActionsOpen(false);
```

Inside `openCommander`, add `setBrowserActionsOpen(false);` before `setCommanderOpen(true);`.

```ts
				setBrowserActionsOpen(false);
```

- [ ] **Step 5: Add the action context callback**

In the `actionContext` object, add this callback after `openSkillSelector`.

```ts
			openBrowserActions: handleOpenBrowserActions,
```

Add `handleOpenBrowserActions` to the dependency array for the `useMemo`.

```ts
			handleOpenBrowserActions,
```

- [ ] **Step 6: Render the Browser action modal**

Render this after `CommandPresetsModal` and before `TerminalCommanderModal`.

```tsx
				<BrowserActionsModal
					open={browserActionsOpen}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={handleCloseBrowserActions}
					onOpenDiff={handleOpenHostDiffity}
					onOpenGitHubIssues={handleOpenGitHubIssuesTarget}
					onOpenGitHubPulls={handleOpenGitHubPullsTarget}
					onOpenUrlSlot={handleOpenHostUrlSlot}
					onEditUrlSlot={handleEditHostUrlSlot}
				/>
```

- [ ] **Step 7: Run typecheck and resolve detail screen wiring errors**

Run:

```bash
cd apps/mobile && pnpm run typecheck
```

Expected: PASS. If it fails, resolve `detail.tsx` imports, dependencies, or callback names and rerun.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): wire browser actions menu"
```

## Task 6: Keyboard Config Update

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Write the failing bundled keyboard config assertion**

Append this test to `apps/mobile/test/integration/keyboard-config.test.ts`.

```ts
void test('phone base Browser key opens browser actions menu directly', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	assert.ok(phoneBaseKeyboard);

	const browserSlot = phoneBaseKeyboard.grid[2]?.[2];
	assert.deepEqual(browserSlot, {
		type: 'action',
		actionId: 'OPEN_BROWSER_ACTIONS',
		label: 'Browser',
		icon: 'ExternalLink',
	});
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: FAIL because the bundled config still has `OPEN_BROWSER_KEYBOARD` and a long-press menu on the Browser key.

- [ ] **Step 3: Edit the Browser key in shell config**

In `apps/mobile/config/shell-config.json`, find the `phone_base` grid row where `"label": "Browser"` appears. Replace that slot with this exact JSON object.

```json
{
	"type": "action",
	"actionId": "OPEN_BROWSER_ACTIONS",
	"label": "Browser",
	"icon": "ExternalLink"
}
```

Keep `browser_keyboard`, `keyboardRouting.actionTargets.OPEN_BROWSER_KEYBOARD`, and the advanced `Set URL` keys unchanged.

- [ ] **Step 4: Bump shell config metadata**

Run:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/bump-shell-config-metadata.mjs
```

Expected: `apps/mobile/config/shell-config.json` has a later `version` and `updatedAt`.

- [ ] **Step 5: Validate shell config**

Run:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
```

Expected: PASS.

- [ ] **Step 6: Run the focused keyboard config test**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "feat(mobile): route browser key to actions menu"
```

## Task 7: Focused Verification

**Files:**
- Verify: `apps/mobile/src/lib/repo-feature-request.ts`
- Verify: `apps/mobile/src/lib/keyboard-actions.ts`
- Verify: `apps/mobile/src/lib/browser-actions.ts`
- Verify: `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx`
- Verify: `apps/mobile/src/app/shell/detail.tsx`
- Verify: `apps/mobile/config/shell-config.json`

- [ ] **Step 1: Run focused integration tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test \
  test/integration/repo-feature-request.test.ts \
  test/integration/keyboard-actions.test.ts \
  test/integration/browser-actions.test.ts \
  test/integration/keyboard-config.test.ts \
  test/integration/shell-config-schema.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
cd apps/mobile && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run shell config validation again**

Run:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
```

Expected: PASS.

- [ ] **Step 4: Inspect the implementation diff for scope**

Run:

```bash
git diff --stat HEAD
git diff -- apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/lib/browser-actions.ts apps/mobile/test/integration/browser-actions.test.ts apps/mobile/src/app/shell/components/BrowserActionsModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
```

Expected: diff is limited to the Browser action menu feature, tests, and shell config metadata.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, Step 2, or Step 3 required fixes, commit them.

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/lib/browser-actions.ts apps/mobile/test/integration/browser-actions.test.ts apps/mobile/src/app/shell/components/BrowserActionsModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "fix(mobile): stabilize browser actions menu"
```

Expected: no commit is created when there were no fixes.

## Task 8: Manual Device Verification

**Files:**
- Verify runtime behavior in `apps/mobile`.

- [ ] **Step 1: Build or deploy the app runtime**

Because this is an app runtime change, JSON reload alone is not enough. Use the repo's normal preview build workflow.

```bash
cd apps/mobile && pnpm exec eas build --local --profile preview --platform android
```

Expected: local preview Android build completes.

- [ ] **Step 2: Install and open the preview build**

Install the produced APK with the current repo/device workflow. Before uninstalling an existing differently signed build, export backup JSON from `Settings -> Backup & Restore`.

Expected: app opens with package `com.finalapp.vibe2`.

- [ ] **Step 3: Verify Browser menu behavior**

On a tmux-enabled connection in a GitHub-backed repository:

1. Tap `Browser`; expected: Browser action menu opens.
2. Tap `Diff`; expected: Android opens a Diffity HTTPS URL.
3. Tap `Browser`, then `GitHub Issues`; expected: Android opens `https://github.com/<owner>/<repo>/issues`.
4. Tap `Browser`, then `GitHub Pull Requests`; expected: Android opens `https://github.com/<owner>/<repo>/pulls`.
5. Tap `Browser`, then each saved URL row; expected: Android opens the saved URL.
6. Clear a test URL slot from `<pane_current_path>/tmux-config.toml`, tap that row, enter a valid URL, and submit; expected: modal saves and Android opens it.
7. Tap `Browser`, long-press each URL row; expected: set/edit modal opens and Android does not open the URL before submit.

- [ ] **Step 4: Commit manual-verification note if project practice requires it**

If this work is going into a PR, include the manual verification results in the PR body rather than a code commit.

Expected: no source files change for manual verification notes.

## Task 9: Final Quality Gate

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run the mobile check commands**

Run:

```bash
cd apps/mobile && pnpm run lint:check
cd apps/mobile && pnpm run typecheck
cd apps/mobile && pnpm run test:integration
```

Expected: PASS for lint, typecheck, and integration tests.

- [ ] **Step 2: Run repo-level check**

Run:

```bash
pnpm exec turbo lint:check
```

Expected: PASS. If unrelated packages fail, capture the failing package and error text in the handoff.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional files are modified or the worktree is clean after commits.

- [ ] **Step 4: Final implementation commit**

If Task 7 through Task 9 produced additional fixes, commit them.

```bash
git add apps/mobile/src/lib/repo-feature-request.ts apps/mobile/test/integration/repo-feature-request.test.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts apps/mobile/src/lib/browser-actions.ts apps/mobile/test/integration/browser-actions.test.ts apps/mobile/src/app/shell/components/BrowserActionsModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "fix(mobile): complete browser actions verification"
```

Expected: no commit is created when there were no additional fixes.
