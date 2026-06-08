# mdev Codex Restart Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicate mobile `codex auth refresh new` command menu
entry with a `restart codex` entry that runs `mdev codex restart` against the
Codex role target resolved by `mdev tmux app context`.

**Architecture:** This is a bundled shell-config change only. The existing
command menu parser, modal rendering, and preset runner already support
text-plus-enter presets, so the implementation updates the JSON menu tree and
the integration tests that lock that tree.

**Tech Stack:** Expo React Native app, TypeScript integration tests with
`node:test`, bundled JSON shell config, pnpm workspace.

---

## File Structure

- Modify `apps/mobile/test/integration/command-menu.test.ts`
  - Owns integration coverage for the bundled command menu tree and command
    preset steps.
  - Update the expected `mdev` submenu labels.
  - Replace the duplicate-auth test with assertions for absent
    `codex auth refresh new`, retained `codex auth refresh`, and new
    `restart codex`.
- Modify `apps/mobile/config/shell-config.json`
  - Owns the bundled mobile shell configuration.
  - Remove the `codex auth refresh new` preset object.
  - Add the `restart codex` preset object with text
    `mdev codex restart "$(mdev tmux app context --session main | sed -n 's/.*"target":"\\([^"]*\\)".*/\\1/p')"`
    followed by Enter.

No new files, native code, UI components, schemas, or remote-command helpers are
needed.

---

### Task 1: Lock the Desired mdev Menu in Tests

**Files:**

- Modify: `apps/mobile/test/integration/command-menu.test.ts`

- [ ] **Step 1: Update the expected `mdev` submenu tree**

In `apps/mobile/test/integration/command-menu.test.ts`, inside the
`bundled command menu exposes the approved Issue 91 tree` test, replace the
`mdev` submenu children block with:

```ts
			children: [
				{ label: 'Request a Feature', type: 'action' },
				{ label: 'Open Workspace', type: 'preset' },
				{ label: 'Close Workspace', type: 'preset' },
				{ label: 'Rename Workspace', type: 'preset' },
				{ label: 'codex auth refresh', type: 'preset' },
				{ label: 'restart codex', type: 'preset' },
			],
```

- [ ] **Step 2: Replace the duplicate auth-refresh test**

In the same file, replace the full test named
`codex auth refresh variants intentionally share the same command for now` with:

```ts
void test('mdev codex presets expose auth refresh and restart commands', () => {
	const commandMenus = getBundledShellConfig().commandMenus;
	const mdev = commandMenus.find(
		(entry) => entry.type === 'submenu' && entry.label === 'mdev',
	);
	assert.ok(mdev);
	assert.equal(mdev.type, 'submenu');
	assert.equal(
		mdev.entries.some((entry) => entry.label === 'codex auth refresh new'),
		false,
	);

	assert.deepEqual(findPreset(commandMenus, ['mdev', 'codex auth refresh']), {
		type: 'preset',
		label: 'codex auth refresh',
		steps: [
			{ type: 'text', data: 'mdev codex auth refresh' },
			{ type: 'enter' },
		],
	});
	assert.deepEqual(findPreset(commandMenus, ['mdev', 'restart codex']), {
		type: 'preset',
		label: 'restart codex',
		steps: [
			{
				type: 'text',
				data: `mdev codex restart "$(mdev tmux app context --session main | sed -n 's/.*"target":"\\([^"]*\\)".*/\\1/p')"`,
			},
			{ type: 'enter' },
		],
	});
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu.test.ts
```

Expected: FAIL. The failure should mention the old tree still includes
`codex auth refresh new` or that the `restart codex` preset is missing.

---

### Task 2: Update the Bundled Shell Config

**Files:**

- Modify: `apps/mobile/config/shell-config.json`

- [ ] **Step 1: Replace the Codex preset section**

In `apps/mobile/config/shell-config.json`, inside the `commandMenus` entry with
`"label": "mdev"`, replace the two existing Codex preset objects:

```json
				{
					"type": "preset",
					"label": "codex auth refresh new",
					"steps": [
						{
							"type": "text",
							"data": "mdev codex auth refresh"
						},
						{
							"type": "enter"
						}
					]
				},
				{
					"type": "preset",
					"label": "codex auth refresh",
					"steps": [
						{
							"type": "text",
							"data": "mdev codex auth refresh"
						},
						{
							"type": "enter"
						}
					]
				}
```

with:

```json
				{
					"type": "preset",
					"label": "codex auth refresh",
					"steps": [
						{
							"type": "text",
							"data": "mdev codex auth refresh"
						},
						{
							"type": "enter"
						}
					]
				},
				{
					"type": "preset",
					"label": "restart codex",
					"steps": [
						{
							"type": "text",
							"data": "mdev codex restart \"$(mdev tmux app context --session main | sed -n 's/.*\"target\":\"\\([^\"]*\\)\".*/\\1/p')\""
						},
						{
							"type": "enter"
						}
					]
				}
```

- [ ] **Step 2: Validate the shell config schema**

Run:

```bash
cd apps/mobile && pnpm run validate:shell-config
```

Expected: PASS. The command should exit with code 0 and not report JSON or
schema validation errors.

- [ ] **Step 3: Run the focused command menu test**

Run:

```bash
cd apps/mobile && pnpm exec tsx --test test/integration/command-menu.test.ts
```

Expected: PASS. The updated tree and Codex preset assertions should pass.

- [ ] **Step 4: Run the mobile integration suite**

Run:

```bash
cd apps/mobile && pnpm run test:integration
```

Expected: PASS. This catches shell-config parser, command menu selection, and
preset execution regressions near this change.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/command-menu.test.ts
git commit -m "Update mdev codex command menu"
```

Expected: commit succeeds with only the bundled config and command menu test
changes staged.

---

## Self-Review

- Spec coverage: Task 1 locks removal of `codex auth refresh new`, retention of
  `codex auth refresh`, and addition of `restart codex`; Task 2 implements those
  exact menu entries in the bundled config.
- Placeholder scan: The plan contains no placeholder work. Every code change,
  command, and expected result is explicit.
- Type consistency: The plan uses existing `CommandMenuEntry`, `CommandPreset`,
  and `findPreset` patterns from
  `apps/mobile/test/integration/command-menu.test.ts`; no new type or helper is
  introduced.
