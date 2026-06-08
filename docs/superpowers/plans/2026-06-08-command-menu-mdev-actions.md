# Command Menu mdev Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile `Cmds` menu support native action entries and update its tree to the approved Issue 91 mdev-oriented structure.

**Architecture:** Extend the runtime shell config model so command menu entries can be terminal presets, submenus, or native app actions. Keep action dispatch on the existing keyboard action path, add a tiny pure command-menu selection helper for testability, and update only the bundled command menu JSON for the approved labels and commands.

**Tech Stack:** Expo React Native, TypeScript, Zod, `node:test` through `tsx`, bundled JSON shell config validation.

---

## File Structure

- Modify `apps/mobile/src/lib/shell-config.ts`
  - Owns runtime shell config types and Zod validation.
  - Add `CommandActionEntry` and recursive action-id validation for `commandMenus`.
- Modify `apps/mobile/test/integration/shell-config-schema.test.ts`
  - Adds red/green coverage for command menu action entries.
- Create `apps/mobile/src/lib/command-menu-selection.ts`
  - Pure helper that classifies one selected command menu entry as submenu, preset, or native action.
  - Keeps modal branching testable without adding React Native component test tooling.
- Create `apps/mobile/test/integration/command-menu-selection.test.ts`
  - Covers pure command menu selection behavior.
- Modify `apps/mobile/src/app/shell/components/CommandPresetsModal.tsx`
  - Uses the pure selection helper.
  - Adds `onAction` prop and closes the modal before dispatching native actions.
- Modify `apps/mobile/src/app/shell/detail.tsx`
  - Passes existing `handleAction` to `CommandPresetsModal`.
- Modify `apps/mobile/config/shell-config.json`
  - Updates `version`, `updatedAt`, and `commandMenus` to the approved tree.
- Modify `apps/mobile/test/integration/command-presets.test.ts`
  - Replaces stale menu expectations with one full-tree assertion and targeted command behavior assertions.

---

### Task 1: Add Command Menu Action Schema

**Files:**
- Modify: `apps/mobile/test/integration/shell-config-schema.test.ts`
- Modify: `apps/mobile/src/lib/shell-config.ts`

- [ ] **Step 1: Write failing schema tests**

Append these tests to `apps/mobile/test/integration/shell-config-schema.test.ts`:

```ts
void test('runtime shell config accepts command menu action entries', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'action',
			label: 'Request a Feature',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
		},
	];

	const parsed = parseShellConfigData(config);

	assert.deepEqual(parsed.commandMenus, [
		{
			type: 'action',
			label: 'Request a Feature',
			actionId: 'OPEN_REPO_FEATURE_REQUEST',
		},
	]);
});

void test('runtime shell config rejects unsupported command menu action ids', () => {
	const config = JSON.parse(bundledConfigText) as Record<string, unknown>;
	config.commandMenus = [
		{
			type: 'submenu',
			label: 'mdev',
			presets: [
				{
					type: 'action',
					label: 'Broken',
					actionId: 'NOT_A_REAL_ACTION',
				},
			],
		},
	];

	assert.throws(() => parseShellConfigData(config), /NOT_A_REAL_ACTION/);
});
```

- [ ] **Step 2: Run the focused schema test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-config-schema.test.ts
```

Expected: FAIL because `commandPresetEntrySchema` does not accept `type: 'action'` entries inside `commandMenus`.

- [ ] **Step 3: Add the `CommandActionEntry` type**

In `apps/mobile/src/lib/shell-config.ts`, replace the command menu type block:

```ts
export type CommandPresetMenu = {
	type: 'submenu';
	label: string;
	presets: CommandPresetEntry[];
};

export type CommandPresetEntry = CommandPreset | CommandPresetMenu;
```

with:

```ts
export type CommandActionEntry = {
	type: 'action';
	label: string;
	actionId: ActionId;
};

export type CommandPresetMenu = {
	type: 'submenu';
	label: string;
	presets: CommandPresetEntry[];
};

export type CommandPresetEntry =
	| CommandPreset
	| CommandPresetMenu
	| CommandActionEntry;
```

- [ ] **Step 4: Add the Zod schema for command menu actions**

In `apps/mobile/src/lib/shell-config.ts`, after `const commandPresetSchema = ...`, add:

```ts
const commandActionEntrySchema = z.object({
	type: z.literal('action'),
	label: z.string().min(1),
	actionId: z.string().min(1),
});
```

Then replace the `commandPresetEntrySchema` definition with:

```ts
const commandPresetEntrySchema: z.ZodType<CommandPresetEntry> = z.lazy(() =>
	z.discriminatedUnion('type', [
		commandPresetSchema,
		commandActionEntrySchema,
		z.object({
			type: z.literal('submenu'),
			label: z.string().min(1),
			presets: z.array(commandPresetEntrySchema),
		}),
	]),
);
```

- [ ] **Step 5: Add recursive action-id validation for command menus**

In `apps/mobile/src/lib/shell-config.ts`, after `validateExecutableItemReferences`, add:

```ts
function validateCommandMenuEntryReferences({
	entry,
	path,
	ctx,
}: {
	entry: CommandPresetEntry;
	path: (string | number)[];
	ctx: z.RefinementCtx;
}) {
	if (entry.type === 'action' && !supportedActionIds.has(entry.actionId)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: [...path, 'actionId'],
			message: `Unsupported command menu actionId ${entry.actionId}`,
		});
		return;
	}

	if (entry.type !== 'submenu') return;

	for (const [index, child] of entry.presets.entries()) {
		validateCommandMenuEntryReferences({
			entry: child,
			path: [...path, 'presets', index],
			ctx,
		});
	}
}
```

At the end of the `shellConfigSchema.superRefine((config, ctx) => { ... })` body, before the closing `});`, add:

```ts
		for (const [index, entry] of config.commandMenus.entries()) {
			validateCommandMenuEntryReferences({
				entry,
				path: ['commandMenus', index],
				ctx,
			});
		}
```

- [ ] **Step 6: Run the focused schema test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-config-schema.test.ts
```

Expected: PASS for every test in `shell-config-schema.test.ts`.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add apps/mobile/src/lib/shell-config.ts apps/mobile/test/integration/shell-config-schema.test.ts
git commit -m "Add command menu action schema"
```

---

### Task 2: Route Command Menu Action Selection

**Files:**
- Create: `apps/mobile/src/lib/command-menu-selection.ts`
- Create: `apps/mobile/test/integration/command-menu-selection.test.ts`
- Modify: `apps/mobile/src/app/shell/components/CommandPresetsModal.tsx`
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Write the failing pure selection tests**

Create `apps/mobile/test/integration/command-menu-selection.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolveCommandMenuSelection,
	type CommandMenuSelectionResult,
} from '../../src/lib/command-menu-selection';
import type { CommandPresetEntry } from '../../src/lib/shell-config';

void test('command menu selection resolves submenu entries', () => {
	const entry: CommandPresetEntry = {
		type: 'submenu',
		label: 'mdev',
		presets: [],
	};

	assert.deepEqual(resolveCommandMenuSelection(entry), {
		type: 'submenu',
		menu: entry,
	} satisfies CommandMenuSelectionResult);
});

void test('command menu selection resolves terminal preset entries', () => {
	const entry: CommandPresetEntry = {
		type: 'preset',
		label: '/new',
		steps: [{ type: 'text', data: '/new' }, { type: 'enter' }],
	};

	assert.deepEqual(resolveCommandMenuSelection(entry), {
		type: 'preset',
		preset: entry,
	} satisfies CommandMenuSelectionResult);
});

void test('command menu selection resolves native action entries', () => {
	const entry: CommandPresetEntry = {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	};

	assert.deepEqual(resolveCommandMenuSelection(entry), {
		type: 'action',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	} satisfies CommandMenuSelectionResult);
});
```

- [ ] **Step 2: Run the focused selection test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu-selection.test.ts
```

Expected: FAIL because `../../src/lib/command-menu-selection` does not exist.

- [ ] **Step 3: Add the pure command menu selection helper**

Create `apps/mobile/src/lib/command-menu-selection.ts` with:

```ts
import type { ActionId } from '@/lib/keyboard-actions';
import type {
	CommandPreset,
	CommandPresetEntry,
	CommandPresetMenu,
} from '@/lib/shell-config';

export type CommandMenuSelectionResult =
	| { type: 'submenu'; menu: CommandPresetMenu }
	| { type: 'preset'; preset: CommandPreset }
	| { type: 'action'; actionId: ActionId };

export function resolveCommandMenuSelection(
	entry: CommandPresetEntry,
): CommandMenuSelectionResult {
	switch (entry.type) {
		case 'submenu':
			return { type: 'submenu', menu: entry };
		case 'preset':
			return { type: 'preset', preset: entry };
		case 'action':
			return { type: 'action', actionId: entry.actionId };
	}
}
```

- [ ] **Step 4: Run the focused selection test and verify it passes**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu-selection.test.ts
```

Expected: PASS for all three command menu selection tests.

- [ ] **Step 5: Update `CommandPresetsModal` to use the helper**

In `apps/mobile/src/app/shell/components/CommandPresetsModal.tsx`, add these imports:

```ts
import { resolveCommandMenuSelection } from '@/lib/command-menu-selection';
import { type ActionId } from '@/lib/keyboard-actions';
```

Update the component signature from:

```ts
export function CommandPresetsModal({
	open,
	presets,
	bottomOffset,
	onClose,
	onSelect,
}: {
	open: boolean;
	presets: CommandPresetEntry[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
}) {
```

to:

```ts
export function CommandPresetsModal({
	open,
	presets,
	bottomOffset,
	onClose,
	onSelect,
	onAction,
}: {
	open: boolean;
	presets: CommandPresetEntry[];
	bottomOffset: number;
	onClose: () => void;
	onSelect: (preset: CommandPreset) => void;
	onAction: (actionId: ActionId) => void;
}) {
```

Replace `handlePresetPress` with:

```ts
	const handlePresetPress = (preset: CommandPresetEntry) => {
		const selection = resolveCommandMenuSelection(preset);
		switch (selection.type) {
			case 'submenu':
				setMenuStack((current) => [...current, selection.menu]);
				return;
			case 'preset':
				// Ensure the next open starts at the root even if the parent closes the modal
				// as a side effect of selecting a preset.
				setMenuStack([]);
				onSelect(selection.preset);
				return;
			case 'action':
				handleClose();
				onAction(selection.actionId);
				return;
		}
	};
```

Leave `isCommandPresetMenu` in place because the render path still uses it to
show the submenu chevron.

- [ ] **Step 6: Pass `handleAction` from shell detail**

In `apps/mobile/src/app/shell/detail.tsx`, update the `CommandPresetsModal`
props from:

```tsx
				<CommandPresetsModal
					open={commandPresetsModal.open}
					presets={shellConfig.commandMenus}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={commandPresetsModal.onClose}
					onSelect={runCommandPreset}
				/>
```

to:

```tsx
				<CommandPresetsModal
					open={commandPresetsModal.open}
					presets={shellConfig.commandMenus}
					bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
					onClose={commandPresetsModal.onClose}
					onSelect={runCommandPreset}
					onAction={handleAction}
				/>
```

- [ ] **Step 7: Run focused tests and typecheck for Task 2**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu-selection.test.ts test/integration/keyboard-actions.test.ts
cd apps/mobile && pnpm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add apps/mobile/src/lib/command-menu-selection.ts apps/mobile/test/integration/command-menu-selection.test.ts apps/mobile/src/app/shell/components/CommandPresetsModal.tsx apps/mobile/src/app/shell/detail.tsx
git commit -m "Route command menu native actions"
```

---

### Task 3: Update Bundled Command Menu Tree

**Files:**
- Modify: `apps/mobile/test/integration/command-presets.test.ts`
- Modify: `apps/mobile/config/shell-config.json`

- [ ] **Step 1: Replace command menu tests with full-tree coverage**

Replace `apps/mobile/test/integration/command-presets.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	type CommandPreset,
	type CommandPresetEntry,
	getBundledShellConfig,
} from '../../src/lib/shell-config';

type CommandTreeNode = {
	label: string;
	type: CommandPresetEntry['type'];
	children?: CommandTreeNode[];
};

function commandTree(entries: CommandPresetEntry[]): CommandTreeNode[] {
	return entries.map((entry) => {
		if (entry.type !== 'submenu') {
			return { label: entry.label, type: entry.type };
		}
		return {
			label: entry.label,
			type: entry.type,
			children: commandTree(entry.presets),
		};
	});
}

function findPreset(
	entries: CommandPresetEntry[],
	path: readonly string[],
): CommandPreset {
	const [head, ...tail] = path;
	assert.ok(head);
	const entry = entries.find((candidate) => candidate.label === head);
	assert.ok(entry, `Missing command menu entry ${path.join(' > ')}`);
	if (tail.length === 0) {
		assert.equal(entry.type, 'preset');
		return entry;
	}
	assert.equal(entry.type, 'submenu');
	return findPreset(entry.presets, tail);
}

void test('bundled command menu exposes the approved Issue 91 tree', () => {
	assert.deepEqual(commandTree(getBundledShellConfig().commandMenus), [
		{ label: '/new', type: 'preset' },
		{
			label: 'superpower',
			type: 'submenu',
			children: [
				{ label: '$test-driven-development', type: 'preset' },
				{ label: '$systematic-debugging', type: 'preset' },
				{ label: '$verification-before-completion', type: 'preset' },
				{ label: '$brainstorming', type: 'preset' },
				{ label: '$writing-plans', type: 'preset' },
				{ label: '$executing-plans', type: 'preset' },
				{ label: '$dispatching-parallel-agents', type: 'preset' },
				{ label: '$subagent-driven-development', type: 'preset' },
				{ label: '$subagent-driven-development-ce1', type: 'preset' },
				{ label: '$requesting-code-review', type: 'preset' },
				{ label: '$receiving-code-review', type: 'preset' },
				{ label: '$finishing-a-development-branch', type: 'preset' },
				{ label: '$writing-skills', type: 'preset' },
				{ label: '$using-superpowers', type: 'preset' },
			],
		},
		{
			label: 'features',
			type: 'submenu',
			children: [
				{ label: '$work-on-bug', type: 'preset' },
				{ label: '$work-on-bug-reflect', type: 'preset' },
				{ label: '$work-on-issue', type: 'preset' },
				{ label: '$dev-work-on-commission-bug', type: 'preset' },
				{ label: '$work-step-by-step', type: 'preset' },
				{ label: '$tldr', type: 'preset' },
				{ label: '/rloop-review', type: 'preset' },
				{ label: '$oracle-ask', type: 'preset' },
			],
		},
		{
			label: 'Git',
			type: 'submenu',
			children: [
				{ label: '$git-pr', type: 'preset' },
				{ label: 'dev pull status', type: 'preset' },
				{ label: 'git checkout dev', type: 'preset' },
				{ label: 'git pull', type: 'preset' },
				{ label: 'git status', type: 'preset' },
				{ label: 'clear', type: 'preset' },
			],
		},
		{
			label: 'mdev',
			type: 'submenu',
			children: [
				{ label: 'Request a Feature', type: 'action' },
				{ label: 'Open Workspace', type: 'preset' },
				{ label: 'Close Workspace', type: 'preset' },
				{ label: 'Rename Workspace', type: 'preset' },
				{ label: 'codex auth refresh new', type: 'preset' },
				{ label: 'codex auth refresh', type: 'preset' },
			],
		},
		{
			label: 'core8',
			type: 'submenu',
			children: [
				{ label: 'yarn cq', type: 'preset' },
				{ label: 'yarn test:ci', type: 'preset' },
				{ label: 'core8 env fix', type: 'preset' },
				{ label: 'core8 jobs switch T0', type: 'preset' },
				{ label: 'core8 env switch staging', type: 'preset' },
			],
		},
	]);
});

void test('mdev submenu routes feature request through a native app action', () => {
	const mdev = getBundledShellConfig().commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);
	assert.ok(mdev);
	assert.equal(mdev.type, 'submenu');

	assert.deepEqual(mdev.presets[0], {
		type: 'action',
		label: 'Request a Feature',
		actionId: 'OPEN_REPO_FEATURE_REQUEST',
	});
});

void test('mdev workspace presets run existing tmux workspace commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(findPreset(commandMenus, ['mdev', 'Open Workspace']), {
		type: 'preset',
		label: 'Open Workspace',
		steps: [
			{ type: 'text', data: 'mdev tmux open-workspace' },
			{ type: 'enter' },
		],
	});
	assert.deepEqual(findPreset(commandMenus, ['mdev', 'Close Workspace']), {
		type: 'preset',
		label: 'Close Workspace',
		steps: [
			{ type: 'text', data: 'mdev tmux workspace close' },
			{ type: 'enter' },
		],
	});
	assert.deepEqual(findPreset(commandMenus, ['mdev', 'Rename Workspace']), {
		type: 'preset',
		label: 'Rename Workspace',
		steps: [
			{ type: 'text', data: 'mdev tmux workspace prompt-rename' },
			{ type: 'enter' },
		],
	});
});

void test('codex auth refresh variants intentionally share the same command for now', () => {
	const commandMenus = getBundledShellConfig().commandMenus;
	const expected = [
		{ type: 'text', data: 'mdev codex auth refresh' },
		{ type: 'enter' },
	];

	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'codex auth refresh new']).steps,
		expected,
	);
	assert.deepEqual(
		findPreset(commandMenus, ['mdev', 'codex auth refresh']).steps,
		expected,
	);
});

void test('core8 submenu owns repo quality commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;

	assert.deepEqual(findPreset(commandMenus, ['core8', 'yarn cq']), {
		type: 'preset',
		label: 'yarn cq',
		steps: [{ type: 'text', data: 'yarn cq' }, { type: 'enter' }],
	});
	assert.deepEqual(findPreset(commandMenus, ['core8', 'yarn test:ci']), {
		type: 'preset',
		label: 'yarn test:ci',
		steps: [{ type: 'text', data: 'yarn test:ci' }, { type: 'enter' }],
	});
	assert.deepEqual(findPreset(commandMenus, ['core8', 'core8 jobs switch T0']), {
		type: 'preset',
		label: 'core8 jobs switch T0',
		steps: [{ type: 'text', data: './bin/core8 jobs switch T0' }],
	});
});
```

- [ ] **Step 2: Run the focused command preset test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-presets.test.ts
```

Expected: FAIL because the bundled `commandMenus` still contains the old tree.

- [ ] **Step 3: Replace bundled `commandMenus` with the approved tree**

In `apps/mobile/config/shell-config.json`:

1. Set `"version"` to `"2026-06-08.1"`.
2. Set `"updatedAt"` to `"2026-06-08T00:00:00.000Z"`.
3. Replace the entire `commandMenus` array with:

```json
[
	{
		"type": "preset",
		"label": "/new",
		"steps": [
			{ "type": "text", "data": "/new" },
			{ "type": "enter" }
		]
	},
	{
		"type": "submenu",
		"label": "superpower",
		"presets": [
			{
				"type": "preset",
				"label": "$test-driven-development",
				"steps": [{ "type": "text", "data": "$test-driven-development" }]
			},
			{
				"type": "preset",
				"label": "$systematic-debugging",
				"steps": [{ "type": "text", "data": "$systematic-debugging" }]
			},
			{
				"type": "preset",
				"label": "$verification-before-completion",
				"steps": [{ "type": "text", "data": "$verification-before-completion" }]
			},
			{
				"type": "preset",
				"label": "$brainstorming",
				"steps": [{ "type": "text", "data": "$brainstorming" }]
			},
			{
				"type": "preset",
				"label": "$writing-plans",
				"steps": [{ "type": "text", "data": "$writing-plans" }]
			},
			{
				"type": "preset",
				"label": "$executing-plans",
				"steps": [{ "type": "text", "data": "$executing-plans" }]
			},
			{
				"type": "preset",
				"label": "$dispatching-parallel-agents",
				"steps": [{ "type": "text", "data": "$dispatching-parallel-agents" }]
			},
			{
				"type": "preset",
				"label": "$subagent-driven-development",
				"steps": [{ "type": "text", "data": "$subagent-driven-development" }]
			},
			{
				"type": "preset",
				"label": "$subagent-driven-development-ce1",
				"steps": [
					{ "type": "text", "data": "$subagent-driven-development-ce1" }
				]
			},
			{
				"type": "preset",
				"label": "$requesting-code-review",
				"steps": [{ "type": "text", "data": "$requesting-code-review" }]
			},
			{
				"type": "preset",
				"label": "$receiving-code-review",
				"steps": [{ "type": "text", "data": "$receiving-code-review" }]
			},
			{
				"type": "preset",
				"label": "$finishing-a-development-branch",
				"steps": [{ "type": "text", "data": "$finishing-a-development-branch" }]
			},
			{
				"type": "preset",
				"label": "$writing-skills",
				"steps": [{ "type": "text", "data": "$writing-skills" }]
			},
			{
				"type": "preset",
				"label": "$using-superpowers",
				"steps": [{ "type": "text", "data": "$using-superpowers" }]
			}
		]
	},
	{
		"type": "submenu",
		"label": "features",
		"presets": [
			{
				"type": "preset",
				"label": "$work-on-bug",
				"steps": [{ "type": "text", "data": "$work-on-bug" }]
			},
			{
				"type": "preset",
				"label": "$work-on-bug-reflect",
				"steps": [{ "type": "text", "data": "$work-on-bug-reflect" }]
			},
			{
				"type": "preset",
				"label": "$work-on-issue",
				"steps": [{ "type": "text", "data": "$work-on-issue" }]
			},
			{
				"type": "preset",
				"label": "$dev-work-on-commission-bug",
				"steps": [{ "type": "text", "data": "$dev-work-on-commission-bug" }]
			},
			{
				"type": "preset",
				"label": "$work-step-by-step",
				"steps": [{ "type": "text", "data": "$work-step-by-step" }]
			},
			{
				"type": "preset",
				"label": "$tldr",
				"steps": [{ "type": "text", "data": "$tldr" }]
			},
			{
				"type": "preset",
				"label": "/rloop-review",
				"steps": [
					{ "type": "text", "data": "/rloop-review" },
					{ "type": "space" }
				]
			},
			{
				"type": "preset",
				"label": "$oracle-ask",
				"steps": [{ "type": "text", "data": "$oracle-ask" }]
			}
		]
	},
	{
		"type": "submenu",
		"label": "Git",
		"presets": [
			{
				"type": "preset",
				"label": "$git-pr",
				"steps": [
					{ "type": "text", "data": "$git-pr" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "dev pull status",
				"steps": [
					{ "type": "text", "data": "git checkout dev" },
					{ "type": "enter" },
					{ "type": "text", "data": "git pull" },
					{ "type": "enter" },
					{ "type": "text", "data": "git status" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "git checkout dev",
				"steps": [
					{ "type": "text", "data": "git checkout dev" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "git pull",
				"steps": [
					{ "type": "text", "data": "git pull" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "git status",
				"steps": [
					{ "type": "text", "data": "git status" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "clear",
				"steps": [
					{ "type": "text", "data": "clear" },
					{ "type": "enter" }
				]
			}
		]
	},
	{
		"type": "submenu",
		"label": "mdev",
		"presets": [
			{
				"type": "action",
				"label": "Request a Feature",
				"actionId": "OPEN_REPO_FEATURE_REQUEST"
			},
			{
				"type": "preset",
				"label": "Open Workspace",
				"steps": [
					{ "type": "text", "data": "mdev tmux open-workspace" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "Close Workspace",
				"steps": [
					{ "type": "text", "data": "mdev tmux workspace close" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "Rename Workspace",
				"steps": [
					{ "type": "text", "data": "mdev tmux workspace prompt-rename" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "codex auth refresh new",
				"steps": [
					{ "type": "text", "data": "mdev codex auth refresh" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "codex auth refresh",
				"steps": [
					{ "type": "text", "data": "mdev codex auth refresh" },
					{ "type": "enter" }
				]
			}
		]
	},
	{
		"type": "submenu",
		"label": "core8",
		"presets": [
			{
				"type": "preset",
				"label": "yarn cq",
				"steps": [
					{ "type": "text", "data": "yarn cq" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "yarn test:ci",
				"steps": [
					{ "type": "text", "data": "yarn test:ci" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "core8 env fix",
				"steps": [
					{ "type": "text", "data": "./bin/core8 env fix" },
					{ "type": "enter" }
				]
			},
			{
				"type": "preset",
				"label": "core8 jobs switch T0",
				"steps": [{ "type": "text", "data": "./bin/core8 jobs switch T0" }]
			},
			{
				"type": "preset",
				"label": "core8 env switch staging",
				"steps": [{ "type": "text", "data": "./bin/core8 env switch staging" }]
			}
		]
	}
]
```

- [ ] **Step 4: Run shell config validation and focused command tests**

Run:

```bash
cd apps/mobile && pnpm run validate:shell-config
cd apps/mobile && pnpm exec tsx --test test/integration/command-presets.test.ts test/integration/shell-config-schema.test.ts test/integration/command-menu-selection.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/command-presets.test.ts
git commit -m "Update command menu mdev tree"
```

---

### Task 4: Final Verification

**Files:**
- No new files.
- Verify all files changed by Tasks 1 through 3.

- [ ] **Step 1: Run focused mobile integration tests**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/shell-config-schema.test.ts test/integration/command-presets.test.ts test/integration/command-menu-selection.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-runtime.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run shell config validation**

Run:

```bash
cd apps/mobile && pnpm run validate:shell-config
```

Expected: exit 0.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
cd apps/mobile && pnpm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Run mobile lint check**

Run:

```bash
cd apps/mobile && pnpm run lint:check
```

Expected: exit 0.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- apps/mobile/src/lib/shell-config.ts apps/mobile/src/lib/command-menu-selection.ts apps/mobile/src/app/shell/components/CommandPresetsModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration/shell-config-schema.test.ts apps/mobile/test/integration/command-menu-selection.test.ts apps/mobile/test/integration/command-presets.test.ts
```

Expected:

- schema diff only adds command menu action support and validation;
- modal diff only adds action selection dispatch;
- `shell-config.json` command tree matches the approved tree;
- tests cover schema, selection, and command tree behavior.

---

## Plan Self-Review

Spec coverage:

- Native command menu action entries are covered by Task 1 and Task 2.
- Exact approved command tree is covered by Task 3.
- `Request a Feature` native routing is covered by Task 2 and Task 3.
- Workspace and Codex command behavior is covered by Task 3.
- Configure modal non-goals are preserved because no task edits `ConfigureModal`.
- Validation is covered by Task 4.

Type consistency:

- `CommandActionEntry`, `CommandPresetEntry`, and `CommandMenuSelectionResult`
  are defined before any plan step uses them.
- `onAction` uses the existing `ActionId` type from `keyboard-actions`.
- The modal continues to accept `CommandPresetEntry[]` and `CommandPreset`.

Scope:

- This plan produces one working feature and does not require a separate
  sub-project plan.
