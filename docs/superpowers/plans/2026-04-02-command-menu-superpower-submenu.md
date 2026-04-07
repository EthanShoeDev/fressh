# Command Menu Superpower Submenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `superpower` submenu to the mobile command menu that inserts `$skill-name` triggers without pressing Enter.

**Architecture:** Keep the change in the existing command preset data source. Add a focused integration test over the exported preset structure, then add the submenu entries with text-only steps so the modal and runtime behavior remain unchanged.

**Tech Stack:** TypeScript, React Native app preset data, Node `node:test`, `tsx --test`

---

### Task 1: Add regression coverage for the submenu data

**Files:**
- Create: `apps/mobile/test/integration/command-presets.test.ts`
- Test: `apps/mobile/test/integration/command-presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { commandPresets } from '../../src/lib/command-presets';

const expectedSkills = [
	'$test-driven-development',
	'$systematic-debugging',
	'$verification-before-completion',
	'$brainstorming',
	'$writing-plans',
	'$executing-plans',
	'$dispatching-parallel-agents',
	'$requesting-code-review',
	'$receiving-code-review',
	'$finishing-a-development-branch',
	'$writing-skills',
	'$using-superpowers',
];

void test('superpower submenu exposes text-only skill presets', () => {
	const submenu = commandPresets.find(
		(preset) => preset.type === 'submenu' && preset.label === 'superpower',
	);

	assert.ok(submenu);
	assert.equal(submenu.type, 'submenu');
	assert.deepEqual(
		submenu.presets.map((preset) => preset.label),
		expectedSkills,
	);

	for (const preset of submenu.presets) {
		assert.equal(preset.type, 'preset');
		assert.deepEqual(preset.steps, [{ type: 'text', data: preset.label }]);
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/mobile test:integration -- test/integration/command-presets.test.ts`
Expected: FAIL because the `superpower` submenu does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
{
	type: 'submenu',
	label: 'superpower',
	presets: expectedSkills.map((label) => ({
		type: 'preset',
		label,
		steps: [{ type: 'text', data: label }],
	})),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/mobile test:integration -- test/integration/command-presets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-02-command-menu-superpower-design.md \
  docs/superpowers/plans/2026-04-02-command-menu-superpower-submenu.md \
  apps/mobile/test/integration/command-presets.test.ts \
  apps/mobile/src/lib/command-presets.ts
git commit -m "Add superpower command presets"
```

### Task 2: Verify no regression in nearby command preset behavior

**Files:**
- Test: `apps/mobile/test/integration/keyboard-runtime.test.ts`

- [ ] **Step 1: Run the nearby integration tests**

```bash
pnpm --dir apps/mobile test:integration
```

- [ ] **Step 2: Confirm expected result**

Expected: PASS for the new command preset test and the existing keyboard runtime
tests.
