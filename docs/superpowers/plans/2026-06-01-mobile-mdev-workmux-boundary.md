# Mobile mdev Workmux Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move mobile Workmux integration toward the `mdev` boundary, use existing wrappers where they are app-callable, and explicitly track remaining direct-tmux behavior behind a separate `mdev` issue.

**Architecture:** The mobile app must not learn new tmux layout details. This plan switches Rust shell attach to `mdev tmux attach`, renames keyboard navigation around role/workspace intent, fences existing direct tmux helpers as temporary violations, and files the missing `mdev` API issue for the pieces that cannot be safely called from the app yet.

**Tech Stack:** Expo React Native, TypeScript node tests, runtime `shell-config.json`, Rust `uniffi-russh`, GitHub CLI.

---

## Scope Notes

The approved spec says to use existing `mdev` wrappers where available and not add new `mdev` subcommands in this repo. During planning, one important gap became clear: `mdev tmux focus ...` and bare `mdev tmux nav next|prev|next-all|prev-all` are useful from tmux keybindings, but they are not yet app-callable from Fressh's non-tmux side-channel shell because they do not accept a stable target/session/workspace argument. Do not replace keyboard role/workspace keys with side-channel calls until the separate `mdev` issue adds target-aware app commands.

This plan therefore implements the safe app-side work now:

- File the `mdev` issue with the missing app-callable API surface.
- Change Rust attach from direct `tmux` to `mdev tmux attach`.
- Rename keyboard intent to role/workspace, but keep the existing keybinding bytes as a named temporary violation.
- Add guard coverage so new direct tmux command strings do not spread.
- Add comments around temporary direct tmux helpers with the reason they remain.

## File Structure

- `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`
  - Owns remote shell startup. Add pure helpers for shell quoting and `mdev tmux attach` command construction, with unit tests in the same file.
- `apps/mobile/config/shell-config.json`
  - Runtime keyboard source of truth. Rename role/workspace keys and remove stale pane wording.
- `apps/mobile/test/integration/keyboard-config.test.ts`
  - Verifies bundled keyboard layout and temporary keybinding behavior.
- `apps/mobile/test/integration/direct-tmux-boundary.test.ts`
  - New guard test that rejects direct `tmux ...` strings outside explicitly allowed temporary-violation files.
- `apps/mobile/src/lib/host-browser-actions.ts`
  - Existing temporary direct tmux helper file for pane path/context and current window id. Add a comment only.
- `apps/mobile/src/lib/tmux-scrollback.ts`
  - Existing temporary direct tmux helper file for copy mode and notification window selection. Add a comment only.
- `apps/mobile/src/app/shell/detail.tsx`
  - Rename the tmux attach error screen copy to Workmux language.

---

### Task 1: File the Missing mdev Wrapper Issue

**Files:**
- No repo file changes.
- External issue: `mulyoved/skills`

- [ ] **Step 1: Create the GitHub issue**

Run this command from `/home/muly/fressh`:

```bash
gh issue create \
  --repo mulyoved/skills \
  --title "Expose app-callable mdev Workmux commands for Fressh mobile" \
  --body "$(cat <<'EOF'
## Context

Fressh mobile is moving to an mdev boundary: the app should not call tmux directly, parse tmux metadata, or rely on tmux keybindings as its application contract.

The current mdev Workmux commands work well from tmux keybindings, but several mobile flows run from a non-tmux side-channel shell. Those flows need stable, target-aware mdev commands.

## Needed app-callable commands

1. Current visible window id
   - Used by Fressh mobile notification acknowledgement.
   - Example replacement target: tmux display-message -p -t 'main:' '#{window_id}'
   - Should return stable machine-readable output.

2. Current pane context/path
   - Used by Browser actions, GitHub actions, mdev open context, and URL storage.
   - Replaces:
     - tmux display-message -p -t 'main:' '#{pane_current_path}'
     - tmux display-message -p -t 'main:' '#{pane_id}\t#{pane_tty}\t#{pane_current_path}'
   - Should return JSON with pane id, tty, current path, session, workspace/window identity if available.

3. Notification target routing
   - Used when a user taps an agent notification.
   - Example replacement target: tmux select-window -t 'main:@12'
   - Should resolve role/home window behavior inside mdev instead of mobile.

4. Scrollback entry and scroll batches
   - Used by Fressh Android touch scrollback.
   - Replaces:
     - tmux copy-mode -t 'main'
     - tmux send-keys -t 'main' -N 3 -X page-up
   - Should be safe to call from a non-tmux side-channel shell.

5. Target-aware role/workspace focus
   - Used by the mobile keyboard if we want to stop relying on tmux keybinding bytes.
   - Current commands:
     - mdev tmux focus <claude|git|codex|bash|next|prev|toggle-git-bash>
     - mdev tmux nav <prev|next|prev-all|next-all>
   - Needed: app-callable forms that accept enough target/session/workspace identity to run from outside tmux.

## Acceptance criteria

- Fressh mobile can perform all Workmux actions by invoking mdev, not tmux.
- Fressh mobile does not need to know tmux role-window metadata, pane indexes, or window format strings.
- Commands provide stable output and nonzero exit codes with useful stderr on failure.
EOF
)"
```

Expected: GitHub prints a URL like `https://github.com/mulyoved/skills/issues/123`.

- [ ] **Step 2: Confirm the issue exists**

Run:

```bash
gh issue list --repo mulyoved/skills --search "Expose app-callable mdev Workmux commands for Fressh mobile" --limit 1
```

Expected: one open issue with the title from Step 1.

---

### Task 2: Switch Rust Attach to mdev

**Files:**
- Modify: `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`

- [ ] **Step 1: Add failing Rust unit tests**

In `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`, add this test module near the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workmux_attach_command_uses_mdev_tmux_attach() {
        assert_eq!(
            build_workmux_attach_command("main"),
            "mdev tmux attach 'main'"
        );
    }

    #[test]
    fn workmux_attach_command_shell_quotes_session_names() {
        assert_eq!(
            build_workmux_attach_command("main's work"),
            "mdev tmux attach 'main'\\''s work'"
        );
    }
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test workmux_attach_command --lib
```

Expected: FAIL with an error like `cannot find function build_workmux_attach_command`.

- [ ] **Step 3: Add the attach command helpers**

In `packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs`, near `TMUX_ATTACH_PROBE_TIMEOUT_MS`, add:

```rust
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn build_workmux_attach_command(session_name: &str) -> String {
    format!("mdev tmux attach {}", shell_quote(session_name))
}
```

- [ ] **Step 4: Replace direct tmux attach**

In `SshConnection::start_shell`, replace:

```rust
let cmd = format!("tmux attach -t {tmux_name}");
ch.exec(true, cmd).await?;
```

with:

```rust
let cmd = build_workmux_attach_command(&tmux_name);
ch.exec(true, cmd).await?;
```

Also update nearby user-facing/probe strings:

```rust
// Short probe window to catch immediate Workmux attach failures.
const TMUX_ATTACH_PROBE_TIMEOUT_MS: u64 = 300;
```

```rust
return Err(SshError::TmuxAttachFailed(
    "Missing Workmux session name".to_string(),
));
```

```rust
"Workmux attach exited with status {exit_status}"
```

```rust
"Workmux attach closed the channel".to_string()
```

Keep the `SshError::TmuxAttachFailed` variant name unchanged because it is part of the existing UniFFI/API error shape.

- [ ] **Step 5: Run the focused Rust test and verify it passes**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test workmux_attach_command --lib
```

Expected: PASS for both `workmux_attach_command_*` tests.

- [ ] **Step 6: Commit the Rust attach change**

Run:

```bash
git add packages/react-native-uniffi-russh/rust/uniffi-russh/src/ssh_connection.rs
git commit -m "fix(russh): attach Workmux through mdev"
```

---

### Task 3: Add Direct tmux Boundary Guard

**Files:**
- Create: `apps/mobile/test/integration/direct-tmux-boundary.test.ts`

- [ ] **Step 1: Write the boundary guard regression test**

Create `apps/mobile/test/integration/direct-tmux-boundary.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

const allowedTemporaryViolationFiles = new Set([
    path.join(
        repoRoot,
        'apps/mobile/src/lib/host-browser-actions.ts',
    ),
    path.join(repoRoot, 'apps/mobile/src/lib/tmux-scrollback.ts'),
]);

const scannedRoots = [
    path.join(repoRoot, 'apps/mobile/src'),
    path.join(
        repoRoot,
        'packages/react-native-uniffi-russh/rust/uniffi-russh/src',
    ),
];

function listSourceFiles(root: string): string[] {
    const entries = readdirSync(root);
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(root, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            if (entry === 'generated') continue;
            files.push(...listSourceFiles(fullPath));
            continue;
        }
        if (/\.(ts|tsx|rs)$/.test(entry)) {
            files.push(fullPath);
        }
    }
    return files;
}

void test('direct tmux command strings stay inside named temporary violation files', () => {
    const violations: string[] = [];
    const directTmuxCommandPattern =
        /\btmux\s+(attach|display-message|select-window|copy-mode|send-keys)\b/;

    for (const root of scannedRoots) {
        for (const file of listSourceFiles(root)) {
            if (allowedTemporaryViolationFiles.has(file)) continue;
            const text = readFileSync(file, 'utf8');
            if (directTmuxCommandPattern.test(text)) {
                violations.push(path.relative(repoRoot, file));
            }
        }
    }

    assert.deepEqual(violations, []);
});
```

- [ ] **Step 2: Run the guard test and verify the Rust attach fix is fenced**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/direct-tmux-boundary.test.ts
```

Expected: PASS after Task 2. If it fails, read the listed files and either remove direct tmux command construction or add a comment and temporary allowlist entry only when it matches the approved missing-wrapper list.

- [ ] **Step 3: Add comments to allowed temporary violation files**

In `apps/mobile/src/lib/host-browser-actions.ts`, add this comment above `buildHostBrowserPanePathCommand`:

```ts
// Temporary mdev-boundary violation: these pane/window context helpers still
// call tmux directly because mdev does not yet expose app-callable wrappers for
// current pane path, pane context, or visible window id. Do not add new direct
// tmux helpers here; move them behind mdev first.
```

In `apps/mobile/src/lib/tmux-scrollback.ts`, add this comment above `buildTmuxScrollbackCopyModeCommand`:

```ts
// Temporary mdev-boundary violation: scrollback entry and notification window
// selection still call tmux directly until mdev exposes app-callable wrappers.
// Do not add new direct tmux helpers here; move them behind mdev first.
```

- [ ] **Step 4: Run the guard test and verify it passes**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/direct-tmux-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the boundary guard**

Run:

```bash
git add \
  apps/mobile/test/integration/direct-tmux-boundary.test.ts \
  apps/mobile/src/lib/host-browser-actions.ts \
  apps/mobile/src/lib/tmux-scrollback.ts
git commit -m "test(mobile): guard mdev Workmux boundary"
```

---

### Task 4: Rename Attach Error UX to Workmux

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Add a focused text assertion test**

There is no component test harness for `TmuxAttachErrorScreen`, so use a source-level integration test. Create `apps/mobile/test/integration/workmux-copy.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const detailSource = readFileSync(
    path.resolve(import.meta.dirname, '../../src/app/shell/detail.tsx'),
    'utf8',
);

void test('attach failure copy uses Workmux language', () => {
    assert.match(detailSource, /Workmux session not found/);
    assert.doesNotMatch(detailSource, /Tmux session not found/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-copy.test.ts
```

Expected: FAIL because `detail.tsx` still contains `Tmux session not found`.

- [ ] **Step 3: Update the attach error title**

In `apps/mobile/src/app/shell/detail.tsx`, replace:

```tsx
Tmux session not found
```

with:

```tsx
Workmux session not found
```

Leave the explanatory sentence unchanged unless a product wording pass is requested later.

- [ ] **Step 4: Run the copy test and verify it passes**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/workmux-copy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the UX copy change**

Run:

```bash
git add apps/mobile/src/app/shell/detail.tsx apps/mobile/test/integration/workmux-copy.test.ts
git commit -m "fix(mobile): use Workmux attach copy"
```

---

### Task 5: Rename Keyboard Role and Workspace Controls

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`

- [ ] **Step 1: Update the keyboard config test first**

In `apps/mobile/test/integration/keyboard-config.test.ts`, rename the test:

```ts
void test('phone base keyboard exposes role and workspace navigation controls', () => {
```

Replace the existing `assert.deepEqual(phoneBaseKeyboard.grid[0]?.[6], ...)` block from the old navigation test with these assertions:

```ts
assert.deepEqual(phoneBaseKeyboard.grid[0]?.[5], {
    type: 'bytes',
    bytes: [27, 91, 49, 59, 53, 66],
    label: 'Role',
    icon: 'SquareSplitVertical',
    longPress: {
        options: [
            {
                type: 'bytes',
                bytes: [27, 91, 49, 59, 53, 66],
                label: 'Next role',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 91, 49, 59, 53, 65],
                label: 'Prev role',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 99],
                label: 'Claude',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 103],
                label: 'Git',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 120],
                label: 'Codex',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 98],
                label: 'Bash',
                icon: null,
            },
        ],
    },
});

assert.deepEqual(phoneBaseKeyboard.grid[0]?.[6], {
    type: 'bytes',
    bytes: [27, 91, 49, 59, 53, 67],
    label: 'Work',
    icon: 'AppWindow',
    span: 2,
    longPress: {
        options: [
            {
                type: 'bytes',
                bytes: [27, 91, 49, 59, 53, 67],
                label: 'Next work',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 91, 49, 59, 53, 68],
                label: 'Prev work',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 91, 49, 59, 55, 67],
                label: 'Next all',
                icon: null,
            },
            {
                type: 'bytes',
                bytes: [27, 91, 49, 59, 55, 68],
                label: 'Prev all',
                icon: null,
            },
        ],
    },
});
```

Add this assertion near `bundled keyboards do not expose tmux history actions`:

```ts
void test('phone base keyboard does not expose stale pane labels', () => {
    const config = getBundledShellConfig();
    const labels = config.keyboards.flatMap((keyboard) =>
        keyboard.grid.flatMap((row) =>
            row.flatMap((slot) => {
                if (!slot) return [];
                const longPressLabels = slot.longPress?.options.map(
                    (option) => option.label,
                ) ?? [];
                return [slot.label, ...longPressLabels];
            }),
        ),
    );

    assert.equal(labels.includes('Pane'), false);
    assert.equal(labels.includes('Window'), false);
    assert.equal(labels.includes('Alt-w'), false);
});
```

- [ ] **Step 2: Run the keyboard config test and verify it fails**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: FAIL because `shell-config.json` still labels keys as `Pane`, `Window`, and `Alt-w`.

- [ ] **Step 3: Update `shell-config.json`**

In `apps/mobile/config/shell-config.json`:

1. Replace the first row slot at zero-based index 5, currently labeled `Pane`, with:

```json
{
  "type": "bytes",
  "bytes": [27, 91, 49, 59, 53, 66],
  "label": "Role",
  "icon": "SquareSplitVertical",
  "longPress": {
    "options": [
      {
        "type": "bytes",
        "bytes": [27, 91, 49, 59, 53, 66],
        "label": "Next role",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 91, 49, 59, 53, 65],
        "label": "Prev role",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 99],
        "label": "Claude",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 103],
        "label": "Git",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 120],
        "label": "Codex",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 98],
        "label": "Bash",
        "icon": null
      }
    ]
  }
}
```

2. Replace the first row slot at zero-based index 6, currently labeled `Window`, with:

```json
{
  "type": "bytes",
  "bytes": [27, 91, 49, 59, 53, 67],
  "label": "Work",
  "icon": "AppWindow",
  "span": 2,
  "longPress": {
    "options": [
      {
        "type": "bytes",
        "bytes": [27, 91, 49, 59, 53, 67],
        "label": "Next work",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 91, 49, 59, 53, 68],
        "label": "Prev work",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 91, 49, 59, 55, 67],
        "label": "Next all",
        "icon": null
      },
      {
        "type": "bytes",
        "bytes": [27, 91, 49, 59, 55, 68],
        "label": "Prev all",
        "icon": null
      }
    ]
  }
}
```

3. Remove the unused `alt_w` macro object from `macrosByKeyboardId.phone_base`.

- [ ] **Step 4: Bump shell config metadata**

Run:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/bump-shell-config-metadata.mjs
```

Expected: prints a new `version=` and `updatedAt=`.

- [ ] **Step 5: Validate shell config and keyboard tests**

Run:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
cd apps/mobile
pnpm exec tsx --test test/integration/keyboard-config.test.ts
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the keyboard config change**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts
git commit -m "chore(mobile): rename Workmux keyboard controls"
```

---

### Task 6: Final Verification

**Files:**
- No intended file changes.

- [ ] **Step 1: Run focused mobile integration tests**

Run:

```bash
cd apps/mobile
pnpm exec tsx --test \
  test/integration/direct-tmux-boundary.test.ts \
  test/integration/workmux-copy.test.ts \
  test/integration/keyboard-config.test.ts \
  test/integration/host-browser-actions.test.ts \
  test/integration/tmux-scrollback.test.ts \
  test/integration/agent-notification-visibility.test.ts \
  test/integration/keyboard-actions.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 2: Run Rust focused tests**

Run:

```bash
cd packages/react-native-uniffi-russh/rust/uniffi-russh
cargo test workmux_attach_command --lib
```

Expected: PASS.

- [ ] **Step 3: Run shell config validation**

Run:

```bash
cd /home/muly/fressh
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
```

Expected: PASS.

- [ ] **Step 4: Inspect direct tmux strings manually**

Run:

```bash
cd /home/muly/fressh
rg -n "tmux (attach|display-message|select-window|copy-mode|send-keys)" apps/mobile/src packages/react-native-uniffi-russh/rust/uniffi-russh/src
```

Expected: only temporary direct-tmux helpers remain in:

```text
apps/mobile/src/lib/host-browser-actions.ts
apps/mobile/src/lib/tmux-scrollback.ts
```

- [ ] **Step 5: Inspect git history and working tree**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: `git status --short` is empty. The recent commits include:

```text
fix(russh): attach Workmux through mdev
test(mobile): guard mdev Workmux boundary
fix(mobile): use Workmux attach copy
chore(mobile): rename Workmux keyboard controls
```

## Post-Implementation Device Step

Because `apps/mobile/config/shell-config.json` changes, publish through the normal config path after the implementation branch is merged/pushed to `dev`. On the device, open the shell Configure modal and tap `Reload config`.
