# Android Host Browser Keyboard Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Android-native keyboard actions that open remote dev URLs, edit shared per-folder URL slots, and cycle tmux window status from the Fressh mobile terminal.

**Architecture:** Add a small remote helper contract in the dev-env scripts, then expose it through pure mobile command-building utilities and React Native keyboard actions. The mobile app resolves the current tmux pane path over side-channel SSH, runs remote helpers, opens URLs through Android `Linking.openURL`, and uses a native modal for missing/editable slot values.

**Tech Stack:** Bash helper scripts, Expo React Native, TypeScript, Node `node:test`, runtime shell config JSON, side-channel SSH via `executeSideChannelCommand`, Android URL opening via `expo-linking`.

---

## Scope Check

The approved spec spans two coupled areas: remote helper scripts and the mobile app. They stay in one plan because the mobile actions need the helper contract to be testable end to end. The tasks are still split so the remote helper contract can be completed and tested before mobile code depends on it.

## File Structure

- Modify `/home/muly/cube9-env0/dev-docs/dev-env/tmux-window-config-url`: add non-interactive `get` and `set-value` commands for Android.
- Modify `/home/muly/cube9-env0/dev-docs/dev-env/tmux-nav.sh`: add `cycle` for Normal -> parked -> inactive -> Normal.
- Create `/home/muly/cube9-env0/dev-docs/dev-env/test-tmux-window-config-url.sh`: shell test for URL get/set behavior.
- Create `/home/muly/cube9-env0/dev-docs/dev-env/test-tmux-nav.sh`: shell test with a fake `tmux` binary for status cycling.
- Create `apps/mobile/src/lib/host-browser-actions.ts`: pure slot definitions, URL validation, URL extraction, and shell command builders.
- Create `apps/mobile/test/integration/host-browser-actions.test.ts`: tests for the pure host-browser helpers.
- Modify `apps/mobile/src/lib/keyboard-actions.ts`: add action IDs and delegate callbacks for browser/status actions.
- Modify `apps/mobile/test/integration/keyboard-actions.test.ts`: tests for the new keyboard action delegation.
- Create `apps/mobile/src/app/shell/components/HostUrlModal.tsx`: native URL prompt/edit modal.
- Modify `apps/mobile/src/app/shell/detail.tsx`: wire action callbacks, remote command execution, modal state, and Android URL opening.
- Modify `apps/mobile/config/shell-config.json`: add browser keyboard, route, open keys, setter keys, and standalone `Status`.
- Modify `apps/mobile/test/integration/keyboard-config.test.ts`: assert the new runtime keyboard layout.
- Modify `apps/mobile/test/integration/keyboard-routing.test.ts`: assert browser keyboard routing.

---

### Task 1: Add Non-Interactive Remote Helper Commands

**Files:**
- Modify: `/home/muly/cube9-env0/dev-docs/dev-env/tmux-window-config-url`
- Modify: `/home/muly/cube9-env0/dev-docs/dev-env/tmux-nav.sh`
- Create: `/home/muly/cube9-env0/dev-docs/dev-env/test-tmux-window-config-url.sh`
- Create: `/home/muly/cube9-env0/dev-docs/dev-env/test-tmux-nav.sh`

- [ ] **Step 1: Write the failing tmux-window-config-url shell test**

Create `/home/muly/cube9-env0/dev-docs/dev-env/test-tmux-window-config-url.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
helper="$script_dir/tmux-window-config-url"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

export TMUX_PANE_PATH="$tmp_dir/project"
mkdir -p "$TMUX_PANE_PATH"

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: %s\nexpected: %s\nactual:   %s\n' "$message" "$expected" "$actual" >&2
    exit 1
  fi
}

missing=$("$helper" get window-url)
assert_eq "$missing" "" "missing slot prints empty output"

"$helper" set-value window-url 'https://github.com/mulyoved/fressh/pull/1'
actual=$("$helper" get window-url)
assert_eq "$actual" 'https://github.com/mulyoved/fressh/pull/1' "get returns saved window-url"

"$helper" set-value dev-web-server-url 'https://dev-remote-machine-1.tail83108.ts.net:5173/app'
actual=$("$helper" get dev-web-server-url)
assert_eq "$actual" 'https://dev-remote-machine-1.tail83108.ts.net:5173/app' "get returns saved dev server URL"

expected_file=$'window-url = "https://github.com/mulyoved/fressh/pull/1"\ndev-web-server-url = "https://dev-remote-machine-1.tail83108.ts.net:5173/app"'
actual_file=$(cat "$TMUX_PANE_PATH/tmux-config.toml")
assert_eq "$actual_file" "$expected_file" "tmux-config.toml contains saved slots"

printf 'tmux-window-config-url tests passed\n'
```

- [ ] **Step 2: Run the tmux-window-config-url test to verify it fails**

Run:

```bash
cd /home/muly/cube9-env0/dev-docs/dev-env
chmod +x test-tmux-window-config-url.sh
./test-tmux-window-config-url.sh
```

Expected: FAIL because `tmux-window-config-url get window-url` prints `unknown command: get` and exits non-zero.

- [ ] **Step 3: Implement get and set-value in tmux-window-config-url**

In `/home/muly/cube9-env0/dev-docs/dev-env/tmux-window-config-url`, update the usage comment near the top to include the new modes:

```bash
#   tmux-window-config-url get <slot>          — print saved URL, if any.
#   tmux-window-config-url set-value <slot> <url> — save URL; no browser open.
```

Then add these cases before the existing `open)` case:

```bash
  get)
    config_get "$slot"
    ;;
  set-value)
    [[ -z "$val" ]] && exit 0
    config_set "$slot" "$val"
    ;;
```

The full `case "$cmd" in` block should include these non-interactive modes:

```bash
case "$cmd" in
  _open_cb)
    [[ -z "$val" ]] && exit 0
    config_set "$slot" "$val"
    emit_osc "$val"
    ;;
  _set_cb)
    [[ -z "$val" ]] && exit 0
    config_set "$slot" "$val"
    ;;
  get)
    config_get "$slot"
    ;;
  set-value)
    [[ -z "$val" ]] && exit 0
    config_set "$slot" "$val"
    ;;
  open)
    url=$(config_get "$slot")
    if [[ -n "$url" ]]; then
      emit_osc "$url"
    else
      tmux command-prompt -p "URL for ${slot}:" \
        "run-shell -b \"TMUX_PANE_TTY=#{pane_tty} TMUX_PANE_PATH=#{pane_current_path} tmux-window-config-url _open_cb '$slot' '%%'\""
    fi
    ;;
  set)
    cur=$(config_get "$slot")
    tmux set-option -gq @url-edit-scratch "$cur"
    tmux command-prompt -F -p "URL for ${slot}:" -I "#{@url-edit-scratch}" \
      "run-shell -b \"TMUX_PANE_PATH=#{pane_current_path} tmux-window-config-url _set_cb '$slot' '%%'\""
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
```

- [ ] **Step 4: Run the tmux-window-config-url test to verify it passes**

Run:

```bash
cd /home/muly/cube9-env0/dev-docs/dev-env
./test-tmux-window-config-url.sh
```

Expected: PASS with `tmux-window-config-url tests passed`.

- [ ] **Step 5: Write the failing tmux-nav cycle shell test**

Create `/home/muly/cube9-env0/dev-docs/dev-env/test-tmux-nav.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

status_file="$tmp_dir/status"
tmux_log="$tmp_dir/tmux.log"
fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin"

cat > "$fake_bin/tmux" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

status_file="${WORKMUX_STATUS_TEST_FILE:?}"
tmux_log="${WORKMUX_TMUX_LOG:?}"
printf '%s\n' "$*" >> "$tmux_log"

if [[ "$1" == "display-message" && "$2" == "-p" && "$3" == '#{@workmux_status}' ]]; then
  [[ -f "$status_file" ]] && cat "$status_file"
  exit 0
fi

if [[ "$1" == "set-option" && "$2" == "-uw" && "$3" == "@workmux_status" ]]; then
  rm -f "$status_file"
  exit 0
fi

if [[ "$1" == "set-option" && "$2" == "-w" && "$3" == "@workmux_status" ]]; then
  printf '%s' "$4" > "$status_file"
  exit 0
fi

printf 'unexpected tmux call: %s\n' "$*" >&2
exit 64
SH
chmod +x "$fake_bin/tmux"

export PATH="$fake_bin:$PATH"
export WORKMUX_STATUS_TEST_FILE="$status_file"
export WORKMUX_TMUX_LOG="$tmux_log"

read_status() {
  [[ -f "$status_file" ]] && cat "$status_file" || true
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: %s\nexpected: %s\nactual:   %s\n' "$message" "$expected" "$actual" >&2
    exit 1
  fi
}

"$script_dir/tmux-nav.sh" cycle
assert_eq "$(read_status)" "🕒" "normal cycles to parked"

"$script_dir/tmux-nav.sh" cycle
assert_eq "$(read_status)" "💤" "parked cycles to inactive"

"$script_dir/tmux-nav.sh" cycle
assert_eq "$(read_status)" "" "inactive cycles to normal"

printf 'tmux-nav cycle tests passed\n'
```

- [ ] **Step 6: Run the tmux-nav test to verify it fails**

Run:

```bash
cd /home/muly/cube9-env0/dev-docs/dev-env
chmod +x test-tmux-nav.sh
./test-tmux-nav.sh
```

Expected: FAIL because `tmux-nav.sh` has no `cycle` case and the first assertion sees an empty status instead of `🕒`.

- [ ] **Step 7: Implement tmux-nav.sh cycle**

In `/home/muly/cube9-env0/dev-docs/dev-env/tmux-nav.sh`, add this helper below `toggle_status()`:

```bash
cycle_status() {
  local current
  current=$(tmux display-message -p '#{@workmux_status}')
  case "$current" in
    "")
      tmux set-option -w @workmux_status "🕒"
      ;;
    "🕒")
      tmux set-option -w @workmux_status "💤"
      ;;
    "💤")
      tmux set-option -uw @workmux_status
      ;;
    *)
      tmux set-option -w @workmux_status "🕒"
      ;;
  esac
}
```

Then add this case before `next)`:

```bash
  cycle)
    cycle_status
    ;;
```

- [ ] **Step 8: Run remote helper tests**

Run:

```bash
cd /home/muly/cube9-env0/dev-docs/dev-env
./test-tmux-window-config-url.sh
./test-tmux-nav.sh
```

Expected: both PASS.

- [ ] **Step 9: Commit remote helper contract changes**

Run from the dev-env repo:

```bash
cd /home/muly/cube9-env0
git status --short
git add dev-docs/dev-env/tmux-window-config-url dev-docs/dev-env/tmux-nav.sh dev-docs/dev-env/test-tmux-window-config-url.sh dev-docs/dev-env/test-tmux-nav.sh
git commit -m "feat(dev-env): add android host browser helper modes"
```

Expected: a commit containing only the helper and helper-test files.

---

### Task 2: Add Mobile Host Browser Pure Helpers

**Files:**
- Create: `apps/mobile/src/lib/host-browser-actions.ts`
- Create: `apps/mobile/test/integration/host-browser-actions.test.ts`

- [ ] **Step 1: Write the failing host-browser helper tests**

Create `apps/mobile/test/integration/host-browser-actions.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDiffityShareCommand,
	buildHostBrowserPanePathCommand,
	buildHostBrowserStatusCycleCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	parseHostBrowserUrlInput,
} from '../../src/lib/host-browser-actions';

void test('extractLastHttpsUrl returns the final https URL from helper output', () => {
	const output = [
		'Base: dev (open PR) - reused',
		'',
		'https://host.tailnet.ts.net:8123/diff?ref=dev',
		'trailing log line',
		'https://host.tailnet.ts.net:9000/diff?ref=main',
	].join('\n');

	assert.equal(
		extractLastHttpsUrl(output),
		'https://host.tailnet.ts.net:9000/diff?ref=main',
	);
	assert.equal(extractLastHttpsUrl('no url here'), null);
});

void test('host browser command builders shell-quote dynamic values', () => {
	assert.equal(
		buildHostBrowserPanePathCommand("main'quoted"),
		"tmux display-message -p -t 'main'\\''quoted:' '#{pane_current_path}'",
	);
	assert.equal(
		buildDiffityShareCommand("/home/muly/work folder/repo's"),
		"cd '/home/muly/work folder/repo'\\''s' && diffity-share",
	);
	assert.equal(
		buildTmuxWindowConfigGetCommand('window-url', "/tmp/work repo"),
		"TMUX_PANE_PATH='/tmp/work repo' tmux-window-config-url get 'window-url'",
	);
	assert.equal(
		buildTmuxWindowConfigSetCommand(
			'dev-web-server-url',
			'/tmp/work repo',
			'https://example.com/app?q=1',
		),
		"TMUX_PANE_PATH='/tmp/work repo' tmux-window-config-url set-value 'dev-web-server-url' 'https://example.com/app?q=1'",
	);
	assert.equal(buildHostBrowserStatusCycleCommand(), 'tmux-nav.sh cycle');
});

void test('host browser URL slots have user-facing labels', () => {
	assert.equal(getHostBrowserUrlSlotLabel('window-url'), 'URL');
	assert.equal(getHostBrowserUrlSlotLabel('dev-web-server-url'), 'Web');
	assert.equal(getHostBrowserUrlSlotLabel('storybook-url'), 'Story');
	assert.equal(getHostBrowserUrlSlotLabel('app-url'), 'App');
});

void test('parseHostBrowserUrlInput trims and validates http URLs', () => {
	assert.deepEqual(parseHostBrowserUrlInput('   '), { type: 'empty' });
	assert.deepEqual(parseHostBrowserUrlInput('ftp://example.com'), {
		type: 'invalid',
		message: 'Enter an http:// or https:// URL.',
	});
	assert.deepEqual(parseHostBrowserUrlInput('not a url'), {
		type: 'invalid',
		message: 'Enter a valid URL.',
	});
	assert.deepEqual(parseHostBrowserUrlInput(' https://example.com/path '), {
		type: 'valid',
		url: 'https://example.com/path',
	});
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: FAIL because `apps/mobile/src/lib/host-browser-actions.ts` does not exist.

- [ ] **Step 3: Implement host-browser pure helpers**

Create `apps/mobile/src/lib/host-browser-actions.ts`:

```ts
export const HOST_BROWSER_URL_SLOTS = [
	'window-url',
	'dev-web-server-url',
	'storybook-url',
	'app-url',
] as const;

export type HostBrowserUrlSlot = (typeof HOST_BROWSER_URL_SLOTS)[number];

export type ParsedHostBrowserUrlInput =
	| { type: 'empty' }
	| { type: 'invalid'; message: string }
	| { type: 'valid'; url: string };

const hostBrowserUrlSlotLabels: Record<HostBrowserUrlSlot, string> = {
	'window-url': 'URL',
	'dev-web-server-url': 'Web',
	'storybook-url': 'Story',
	'app-url': 'App',
};

const hostBrowserUrlSlotSet = new Set<string>(HOST_BROWSER_URL_SLOTS);

export function isHostBrowserUrlSlot(
	value: string,
): value is HostBrowserUrlSlot {
	return hostBrowserUrlSlotSet.has(value);
}

export function getHostBrowserUrlSlotLabel(slot: HostBrowserUrlSlot): string {
	return hostBrowserUrlSlotLabels[slot];
}

export function quoteShell(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function extractLastHttpsUrl(output: string): string | null {
	const matches = output.match(/https:\/\/[^\s"'<>]+/g);
	return matches?.at(-1) ?? null;
}

export function parseHostBrowserUrlInput(
	input: string,
): ParsedHostBrowserUrlInput {
	const trimmed = input.trim();
	if (!trimmed) return { type: 'empty' };
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { type: 'invalid', message: 'Enter a valid URL.' };
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return {
			type: 'invalid',
			message: 'Enter an http:// or https:// URL.',
		};
	}
	return { type: 'valid', url: trimmed };
}

export function buildHostBrowserPanePathCommand(
	tmuxSessionName: string,
): string {
	return `tmux display-message -p -t ${quoteShell(`${tmuxSessionName}:`)} '#{pane_current_path}'`;
}

export function buildDiffityShareCommand(panePath: string): string {
	return `cd ${quoteShell(panePath)} && diffity-share`;
}

export function buildTmuxWindowConfigGetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} tmux-window-config-url get ${quoteShell(slot)}`;
}

export function buildTmuxWindowConfigSetCommand(
	slot: HostBrowserUrlSlot,
	panePath: string,
	url: string,
): string {
	return `TMUX_PANE_PATH=${quoteShell(panePath)} tmux-window-config-url set-value ${quoteShell(slot)} ${quoteShell(url)}`;
}

export function buildHostBrowserStatusCycleCommand(): string {
	return 'tmux-nav.sh cycle';
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/host-browser-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit pure helper utilities**

Run:

```bash
git add apps/mobile/src/lib/host-browser-actions.ts apps/mobile/test/integration/host-browser-actions.test.ts
git commit -m "feat(mobile): add host browser command helpers"
```

---

### Task 3: Add Keyboard Action IDs and Delegation

**Files:**
- Modify: `apps/mobile/src/lib/keyboard-actions.ts`
- Modify: `apps/mobile/test/integration/keyboard-actions.test.ts`

- [ ] **Step 1: Write failing action delegation tests**

Append these tests to `apps/mobile/test/integration/keyboard-actions.test.ts`:

```ts
void test('host browser actions delegate to action context callbacks', async () => {
	const openedSlots: string[] = [];
	const editedSlots: string[] = [];
	let diffityOpened = 0;
	let statusCycled = 0;

	const context = {
		availableKeyboardIds: new Set(),
		selectKeyboard: () => {},
		rotateKeyboard: () => {},
		openConfigurator: () => {},
		sendBytes: () => {},
		pasteClipboard: async () => {},
		copySelection: () => {},
		openHostDiffity: () => {
			diffityOpened += 1;
		},
		openHostUrlSlot: (slot: string) => {
			openedSlots.push(slot);
		},
		editHostUrlSlot: (slot: string) => {
			editedSlots.push(slot);
		},
		cycleWorkmuxStatus: () => {
			statusCycled += 1;
		},
	} as Parameters<typeof runAction>[1];

	await runAction('OPEN_HOST_DIFFITY', context);
	await runAction('OPEN_HOST_URL_WINDOW', context);
	await runAction('OPEN_HOST_URL_DEV_SERVER', context);
	await runAction('OPEN_HOST_URL_STORYBOOK', context);
	await runAction('OPEN_HOST_URL_APP', context);
	await runAction('EDIT_HOST_URL_WINDOW', context);
	await runAction('EDIT_HOST_URL_DEV_SERVER', context);
	await runAction('EDIT_HOST_URL_STORYBOOK', context);
	await runAction('EDIT_HOST_URL_APP', context);
	await runAction('CYCLE_WORKMUX_STATUS', context);

	assert.equal(diffityOpened, 1);
	assert.deepEqual(openedSlots, [
		'window-url',
		'dev-web-server-url',
		'storybook-url',
		'app-url',
	]);
	assert.deepEqual(editedSlots, [
		'window-url',
		'dev-web-server-url',
		'storybook-url',
		'app-url',
	]);
	assert.equal(statusCycled, 1);
});

void test('browser keyboard is a target keyboard action', () => {
	assert.equal(KNOWN_ACTION_IDS.includes('OPEN_BROWSER_KEYBOARD'), true);
});
```

- [ ] **Step 2: Run action tests to verify they fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: FAIL because the new action IDs and callbacks are not defined.

- [ ] **Step 3: Add action IDs and context callbacks**

In `apps/mobile/src/lib/keyboard-actions.ts`, add `OPEN_BROWSER_KEYBOARD` to `KEYBOARD_TARGET_ACTION_IDS`:

```ts
export const KEYBOARD_TARGET_ACTION_IDS = [
	'OPEN_MAIN_MENU',
	'OPEN_SECONDARY_MENU',
	'OPEN_KEYBOARD_MENU',
	'OPEN_ADVANCED_KEYBOARD',
	'OPEN_BROWSER_KEYBOARD',
] as const;
```

Add host-browser action IDs to `KNOWN_ACTION_IDS` after `CYCLE_TMUX_WINDOW`:

```ts
	'OPEN_HOST_DIFFITY',
	'OPEN_HOST_URL_WINDOW',
	'OPEN_HOST_URL_DEV_SERVER',
	'OPEN_HOST_URL_STORYBOOK',
	'OPEN_HOST_URL_APP',
	'EDIT_HOST_URL_WINDOW',
	'EDIT_HOST_URL_DEV_SERVER',
	'EDIT_HOST_URL_STORYBOOK',
	'EDIT_HOST_URL_APP',
	'CYCLE_WORKMUX_STATUS',
```

Import the slot type:

```ts
import { type HostBrowserUrlSlot } from '@/lib/host-browser-actions';
```

Add callbacks to `ActionContext`:

```ts
	openHostDiffity?: () => void;
	openHostUrlSlot?: (slot: HostBrowserUrlSlot) => void;
	editHostUrlSlot?: (slot: HostBrowserUrlSlot) => void;
	cycleWorkmuxStatus?: () => void;
```

Add a branch for browser keyboard routing:

```ts
		case 'OPEN_BROWSER_KEYBOARD': {
			selectKeyboardForAction('OPEN_BROWSER_KEYBOARD', context);
			return;
		}
```

Add branches for host actions:

```ts
		case 'OPEN_HOST_DIFFITY': {
			context.openHostDiffity?.();
			return;
		}
		case 'OPEN_HOST_URL_WINDOW': {
			context.openHostUrlSlot?.('window-url');
			return;
		}
		case 'OPEN_HOST_URL_DEV_SERVER': {
			context.openHostUrlSlot?.('dev-web-server-url');
			return;
		}
		case 'OPEN_HOST_URL_STORYBOOK': {
			context.openHostUrlSlot?.('storybook-url');
			return;
		}
		case 'OPEN_HOST_URL_APP': {
			context.openHostUrlSlot?.('app-url');
			return;
		}
		case 'EDIT_HOST_URL_WINDOW': {
			context.editHostUrlSlot?.('window-url');
			return;
		}
		case 'EDIT_HOST_URL_DEV_SERVER': {
			context.editHostUrlSlot?.('dev-web-server-url');
			return;
		}
		case 'EDIT_HOST_URL_STORYBOOK': {
			context.editHostUrlSlot?.('storybook-url');
			return;
		}
		case 'EDIT_HOST_URL_APP': {
			context.editHostUrlSlot?.('app-url');
			return;
		}
		case 'CYCLE_WORKMUX_STATUS': {
			context.cycleWorkmuxStatus?.();
			return;
		}
```

- [ ] **Step 4: Run action tests**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit keyboard action delegation**

Run:

```bash
git add apps/mobile/src/lib/keyboard-actions.ts apps/mobile/test/integration/keyboard-actions.test.ts
git commit -m "feat(mobile): add host browser keyboard actions"
```

---

### Task 4: Add Native Host URL Modal

**Files:**
- Create: `apps/mobile/src/app/shell/components/HostUrlModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `apps/mobile/src/app/shell/components/HostUrlModal.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

export type HostUrlModalMode = 'open-missing' | 'edit';

export function HostUrlModal({
	open,
	bottomOffset,
	slotLabel,
	initialValue,
	mode,
	isSubmitting,
	error,
	onClose,
	onSubmit,
}: {
	open: boolean;
	bottomOffset: number;
	slotLabel: string;
	initialValue: string;
	mode: HostUrlModalMode;
	isSubmitting: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (value: string) => void;
}) {
	const theme = useTheme();
	const [value, setValue] = useState(initialValue);

	useEffect(() => {
		if (!open) return;
		setValue(initialValue);
	}, [initialValue, open]);

	const handleSubmit = useCallback(() => {
		if (isSubmitting) return;
		onSubmit(value);
	}, [isSubmitting, onSubmit, value]);

	const actionLabel = mode === 'open-missing' ? 'Save & Open' : 'Save';

	return (
		<Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.overlay,
				}}
			>
				<KeyboardAvoidingView
					behavior={Platform.OS === 'ios' ? 'padding' : undefined}
					style={{
						flex: 1,
						justifyContent: 'center',
						paddingBottom: bottomOffset,
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
							width: '85%',
							maxWidth: 400,
							minWidth: 280,
							alignSelf: 'flex-end',
							marginRight: 8,
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
								{mode === 'open-missing'
									? `Set ${slotLabel} URL`
									: `Edit ${slotLabel} URL`}
							</Text>
							<Pressable
								onPress={onClose}
								disabled={isSubmitting}
								style={{
									paddingHorizontal: 10,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
								}}
							>
								<Text style={{ color: theme.colors.textSecondary }}>
									Cancel
								</Text>
							</Pressable>
						</View>

						<Text
							style={{
								color: theme.colors.textSecondary,
								fontSize: 14,
								fontWeight: '600',
								marginBottom: 6,
							}}
						>
							URL
						</Text>
						<TextInput
							value={value}
							onChangeText={setValue}
							placeholder="https://example.com"
							placeholderTextColor={theme.colors.muted}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
							editable={!isSubmitting}
							style={{
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.inputBackground,
								color: theme.colors.textPrimary,
								borderRadius: 10,
								paddingHorizontal: 12,
								paddingVertical: 10,
								marginBottom: 12,
							}}
						/>
						{error ? (
							<Text
								style={{
									color: theme.colors.danger,
									fontSize: 12,
									fontWeight: '600',
									marginBottom: 12,
								}}
							>
								{error}
							</Text>
						) : null}
						<Pressable
							onPress={handleSubmit}
							disabled={isSubmitting}
							style={{
								backgroundColor: isSubmitting
									? theme.colors.border
									: theme.colors.primary,
								borderRadius: 10,
								paddingVertical: 12,
								alignItems: 'center',
								flexDirection: 'row',
								justifyContent: 'center',
							}}
						>
							{isSubmitting ? (
								<ActivityIndicator
									size="small"
									color={theme.colors.buttonTextOnPrimary}
									style={{ marginRight: 8 }}
								/>
							) : null}
							<Text
								style={{
									color: theme.colors.buttonTextOnPrimary,
									fontWeight: '700',
								}}
							>
								{isSubmitting ? 'Saving...' : actionLabel}
							</Text>
						</Pressable>
					</View>
				</KeyboardAvoidingView>
			</Pressable>
		</Modal>
	);
}
```

- [ ] **Step 2: Run typecheck for the component**

Run:

```bash
pnpm --dir apps/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit the modal component**

Run:

```bash
git add apps/mobile/src/app/shell/components/HostUrlModal.tsx
git commit -m "feat(mobile): add host URL modal"
```

---

### Task 5: Wire Host Browser Actions in Shell Detail

**Files:**
- Modify: `apps/mobile/src/app/shell/detail.tsx`

- [ ] **Step 1: Add imports and state types**

In `apps/mobile/src/app/shell/detail.tsx`, add imports:

```ts
import {
	buildDiffityShareCommand,
	buildHostBrowserPanePathCommand,
	buildHostBrowserStatusCycleCommand,
	buildTmuxWindowConfigGetCommand,
	buildTmuxWindowConfigSetCommand,
	extractLastHttpsUrl,
	getHostBrowserUrlSlotLabel,
	parseHostBrowserUrlInput,
	type HostBrowserUrlSlot,
} from '@/lib/host-browser-actions';
```

Add the modal import near the other component imports:

```ts
import {
	HostUrlModal,
	type HostUrlModalMode,
} from './components/HostUrlModal';
```

Add this type near the existing local types:

```ts
type HostUrlModalState = {
	mode: HostUrlModalMode;
	slot: HostBrowserUrlSlot;
	panePath: string;
	initialValue: string;
};
```

- [ ] **Step 2: Add modal state**

Inside `ShellDetail()`, near the existing modal state declarations, add:

```ts
const [hostUrlModalState, setHostUrlModalState] =
	useState<HostUrlModalState | null>(null);
const [hostUrlModalSubmitting, setHostUrlModalSubmitting] = useState(false);
const [hostUrlModalError, setHostUrlModalError] = useState<string | null>(null);
```

- [ ] **Step 3: Add remote helper functions**

Add these callbacks before `actionContext`:

```ts
const showHostBrowserError = useCallback((title: string, message: string) => {
	Alert.alert(title, message);
}, []);

const runHostBrowserCommand = useCallback(
	async (command: string, timeoutMs = 30_000) => {
		if (!connection) {
			throw new Error('No SSH connection available.');
		}
		const result = await executeSideChannelCommand(
			connection,
			command,
			timeoutMs,
		);
		if (!result.success) {
			throw new Error(result.error || result.output || 'Remote command failed.');
		}
		return result.output.trim();
	},
	[connection],
);

const resolveHostBrowserPanePath = useCallback(async () => {
	if (!tmuxEnabled) {
		throw new Error('Host browser actions require a tmux-enabled connection.');
	}
	const sessionName = tmuxTarget.trim() || 'main';
	const output = await runHostBrowserCommand(
		buildHostBrowserPanePathCommand(sessionName),
		10_000,
	);
	const panePath = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!panePath) {
		throw new Error(`Could not resolve pane path for tmux session ${sessionName}.`);
	}
	return panePath;
}, [runHostBrowserCommand, tmuxEnabled, tmuxTarget]);

const openAndroidUrl = useCallback(async (url: string) => {
	try {
		await Linking.openURL(url);
	} catch (error) {
		throw new Error(`Android could not open ${url}: ${getErrorMessage(error)}`);
	}
}, []);
```

- [ ] **Step 4: Add Diffity, slot open/edit, submit, and status handlers**

Add these callbacks before `actionContext`:

```ts
const handleOpenHostDiffity = useCallback(() => {
	void (async () => {
		try {
			const panePath = await resolveHostBrowserPanePath();
			const output = await runHostBrowserCommand(
				buildDiffityShareCommand(panePath),
				60_000,
			);
			const url = extractLastHttpsUrl(output);
			if (!url) {
				throw new Error(output || 'diffity-share did not return an HTTPS URL.');
			}
			await openAndroidUrl(url);
		} catch (error) {
			showHostBrowserError('Diffity failed', getErrorMessage(error));
		}
	})();
}, [
	openAndroidUrl,
	resolveHostBrowserPanePath,
	runHostBrowserCommand,
	showHostBrowserError,
]);

const handleOpenHostUrlSlot = useCallback(
	(slot: HostBrowserUrlSlot) => {
		void (async () => {
			try {
				const panePath = await resolveHostBrowserPanePath();
				const value = await runHostBrowserCommand(
					buildTmuxWindowConfigGetCommand(slot, panePath),
					10_000,
				);
				if (value.trim()) {
					await openAndroidUrl(value.trim());
					return;
				}
				setHostUrlModalError(null);
				setHostUrlModalState({
					mode: 'open-missing',
					slot,
					panePath,
					initialValue: '',
				});
			} catch (error) {
				showHostBrowserError(
					`${getHostBrowserUrlSlotLabel(slot)} failed`,
					getErrorMessage(error),
				);
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

const handleEditHostUrlSlot = useCallback(
	(slot: HostBrowserUrlSlot) => {
		void (async () => {
			try {
				const panePath = await resolveHostBrowserPanePath();
				const value = await runHostBrowserCommand(
					buildTmuxWindowConfigGetCommand(slot, panePath),
					10_000,
				);
				setHostUrlModalError(null);
				setHostUrlModalState({
					mode: 'edit',
					slot,
					panePath,
					initialValue: value.trim(),
				});
			} catch (error) {
				showHostBrowserError(
					`Edit ${getHostBrowserUrlSlotLabel(slot)} failed`,
					getErrorMessage(error),
				);
			}
		})();
	},
	[resolveHostBrowserPanePath, runHostBrowserCommand, showHostBrowserError],
);

const handleCloseHostUrlModal = useCallback(() => {
	if (hostUrlModalSubmitting) return;
	setHostUrlModalState(null);
	setHostUrlModalError(null);
}, [hostUrlModalSubmitting]);

const handleSubmitHostUrlModal = useCallback(
	(value: string) => {
		const state = hostUrlModalState;
		if (!state) return;
		const parsed = parseHostBrowserUrlInput(value);
		if (parsed.type === 'empty') {
			setHostUrlModalState(null);
			setHostUrlModalError(null);
			return;
		}
		if (parsed.type === 'invalid') {
			setHostUrlModalError(parsed.message);
			return;
		}

		void (async () => {
			setHostUrlModalSubmitting(true);
			setHostUrlModalError(null);
			try {
				await runHostBrowserCommand(
					buildTmuxWindowConfigSetCommand(
						state.slot,
						state.panePath,
						parsed.url,
					),
					10_000,
				);
				setHostUrlModalState(null);
				if (state.mode === 'open-missing') {
					await openAndroidUrl(parsed.url);
				}
			} catch (error) {
				setHostUrlModalError(getErrorMessage(error));
			} finally {
				setHostUrlModalSubmitting(false);
			}
		})();
	},
	[hostUrlModalState, openAndroidUrl, runHostBrowserCommand],
);

const handleCycleWorkmuxStatus = useCallback(() => {
	void (async () => {
		try {
			if (!tmuxEnabled) {
				throw new Error('Status cycle requires a tmux-enabled connection.');
			}
			await runHostBrowserCommand(buildHostBrowserStatusCycleCommand(), 10_000);
		} catch (error) {
			showHostBrowserError('Status cycle failed', getErrorMessage(error));
		}
	})();
}, [runHostBrowserCommand, showHostBrowserError, tmuxEnabled]);
```

- [ ] **Step 5: Add callbacks to actionContext**

In the `actionContext` object, add:

```ts
openHostDiffity: handleOpenHostDiffity,
openHostUrlSlot: handleOpenHostUrlSlot,
editHostUrlSlot: handleEditHostUrlSlot,
cycleWorkmuxStatus: handleCycleWorkmuxStatus,
```

Add these dependencies to the `useMemo` dependency array:

```ts
handleCycleWorkmuxStatus,
handleEditHostUrlSlot,
handleOpenHostDiffity,
handleOpenHostUrlSlot,
```

- [ ] **Step 6: Render HostUrlModal**

Near the existing modal renders in the `return`, add:

```tsx
<HostUrlModal
	open={hostUrlModalState != null}
	bottomOffset={Platform.OS === 'android' ? insets.bottom + 24 : 24}
	slotLabel={
		hostUrlModalState
			? getHostBrowserUrlSlotLabel(hostUrlModalState.slot)
			: 'URL'
	}
	initialValue={hostUrlModalState?.initialValue ?? ''}
	mode={hostUrlModalState?.mode ?? 'edit'}
	isSubmitting={hostUrlModalSubmitting}
	error={hostUrlModalError}
	onClose={handleCloseHostUrlModal}
	onSubmit={handleSubmitHostUrlModal}
/>
```

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm --dir apps/mobile typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit shell detail wiring**

Run:

```bash
git add apps/mobile/src/app/shell/detail.tsx
git commit -m "feat(mobile): wire host browser shell actions"
```

---

### Task 6: Add Browser Keyboard and Status/Setter Keys

**Files:**
- Modify: `apps/mobile/config/shell-config.json`
- Modify: `apps/mobile/test/integration/keyboard-config.test.ts`
- Modify: `apps/mobile/test/integration/keyboard-routing.test.ts`

- [ ] **Step 1: Write failing keyboard config tests**

Append this test to `apps/mobile/test/integration/keyboard-config.test.ts`:

```ts
void test('bundled keyboards expose host browser open, edit, and status actions', () => {
	const config = getBundledShellConfig();
	const phoneBaseKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'phone_base',
	);
	const browserKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'browser_keyboard',
	);
	const advancedKeyboard = config.keyboards.find(
		(keyboard) => keyboard.id === 'advanced_keyboard',
	);
	assert.ok(phoneBaseKeyboard);
	assert.ok(browserKeyboard);
	assert.ok(advancedKeyboard);

	assert.deepEqual(phoneBaseKeyboard.grid[3]?.[1], {
		type: 'action',
		actionId: 'OPEN_BROWSER_KEYBOARD',
		label: 'Browser',
		icon: 'ExternalLink',
	});
	assert.deepEqual(phoneBaseKeyboard.grid[3]?.[2], {
		type: 'action',
		actionId: 'CYCLE_WORKMUX_STATUS',
		label: 'Status',
		icon: 'Clock',
	});

	assert.deepEqual(browserKeyboard.grid[0]?.slice(0, 6), [
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
			actionId: 'OPEN_HOST_URL_APP',
			label: 'App',
			icon: 'PanelTop',
		},
	]);

	assert.deepEqual(advancedKeyboard.grid[3]?.slice(0, 4), [
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_WINDOW',
			label: 'Set URL',
			icon: 'Link',
		},
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_DEV_SERVER',
			label: 'Set Web',
			icon: 'Globe',
		},
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_STORYBOOK',
			label: 'Set Story',
			icon: 'BookOpen',
		},
		{
			type: 'action',
			actionId: 'EDIT_HOST_URL_APP',
			label: 'Set App',
			icon: 'PanelTop',
		},
	]);
});
```

Update `apps/mobile/test/integration/keyboard-routing.test.ts` first test to include browser routing assertions:

```ts
	assert.equal(
		getKeyboardActionTarget(config, 'OPEN_BROWSER_KEYBOARD'),
		'browser_keyboard',
	);
```

- [ ] **Step 2: Run keyboard tests to verify they fail**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-config.test.ts test/integration/keyboard-routing.test.ts
```

Expected: FAIL because `browser_keyboard` and the new action slots are not in `shell-config.json`.

- [ ] **Step 3: Update shell-config.json**

Modify `apps/mobile/config/shell-config.json`:

Add `browser_keyboard` to `activeKeyboardIds`:

```json
"activeKeyboardIds": [
  "phone_base",
  "advanced_keyboard",
  "browser_keyboard"
]
```

Add browser routing:

```json
"actionTargets": {
  "OPEN_ADVANCED_KEYBOARD": "advanced_keyboard",
  "OPEN_BROWSER_KEYBOARD": "browser_keyboard",
  "OPEN_MAIN_MENU": "phone_base"
}
```

In `phone_base` row 4, keep `Explain` at column 0 and add:

```json
{
  "type": "action",
  "actionId": "OPEN_BROWSER_KEYBOARD",
  "label": "Browser",
  "icon": "ExternalLink"
},
{
  "type": "action",
  "actionId": "CYCLE_WORKMUX_STATUS",
  "label": "Status",
  "icon": "Clock"
}
```

In `advanced_keyboard` row 4, replace the first four `null` cells with:

```json
{
  "type": "action",
  "actionId": "EDIT_HOST_URL_WINDOW",
  "label": "Set URL",
  "icon": "Link"
},
{
  "type": "action",
  "actionId": "EDIT_HOST_URL_DEV_SERVER",
  "label": "Set Web",
  "icon": "Globe"
},
{
  "type": "action",
  "actionId": "EDIT_HOST_URL_STORYBOOK",
  "label": "Set Story",
  "icon": "BookOpen"
},
{
  "type": "action",
  "actionId": "EDIT_HOST_URL_APP",
  "label": "Set App",
  "icon": "PanelTop"
}
```

Add this full keyboard object after `advanced_keyboard`:

```json
{
  "id": "browser_keyboard",
  "name": "Browser Keyboard",
  "builtIn": true,
  "active": true,
  "rotationOrder": 2,
  "grid": [
    [
      {
        "type": "action",
        "actionId": "OPEN_MAIN_MENU",
        "label": "Back",
        "icon": "X"
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
      },
      null,
      null,
      null,
      null
    ],
    [null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null]
  ]
}
```

Add an empty macro list:

```json
"browser_keyboard": []
```

- [ ] **Step 4: Bump shell config metadata**

Run:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/bump-shell-config-metadata.mjs
```

Expected: prints a new `version` and `updatedAt`.

- [ ] **Step 5: Validate shell config and keyboard tests**

Run:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
pnpm --dir apps/mobile exec tsx --test test/integration/keyboard-config.test.ts test/integration/keyboard-routing.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit runtime keyboard config**

Run:

```bash
git add apps/mobile/config/shell-config.json apps/mobile/test/integration/keyboard-config.test.ts apps/mobile/test/integration/keyboard-routing.test.ts
git commit -m "feat(mobile): add host browser keyboard"
```

---

### Task 7: Final Verification

**Files:**
- Verify all files changed by Tasks 2 through 6 in `/home/muly/fressh`.
- Verify remote helper files changed by Task 1 in `/home/muly/cube9-env0`.

- [ ] **Step 1: Run remote helper tests**

Run:

```bash
cd /home/muly/cube9-env0/dev-docs/dev-env
./test-tmux-window-config-url.sh
./test-tmux-nav.sh
```

Expected: both PASS.

- [ ] **Step 2: Run focused mobile tests**

Run:

```bash
pnpm --dir apps/mobile exec tsx --test test/integration/host-browser-actions.test.ts test/integration/keyboard-actions.test.ts test/integration/keyboard-config.test.ts test/integration/keyboard-routing.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run shell config validation**

Run:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
```

Expected: PASS and output starting with `Valid shell config`.

- [ ] **Step 4: Run mobile typecheck**

Run:

```bash
pnpm --dir apps/mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect diffs**

Run:

```bash
git diff -- apps/mobile/src/lib/host-browser-actions.ts apps/mobile/src/lib/keyboard-actions.ts apps/mobile/src/app/shell/components/HostUrlModal.tsx apps/mobile/src/app/shell/detail.tsx apps/mobile/config/shell-config.json apps/mobile/test/integration
cd /home/muly/cube9-env0
git diff -- dev-docs/dev-env/tmux-window-config-url dev-docs/dev-env/tmux-nav.sh dev-docs/dev-env/test-tmux-window-config-url.sh dev-docs/dev-env/test-tmux-nav.sh
```

Expected: diffs only contain the planned helper contract, host browser action utilities, modal, detail wiring, keyboard config, and tests.

- [ ] **Step 6: Manual Android preview verification**

Use a preview build or the currently installed preview app:

1. Open an SSH connection with `useTmux: true` and `tmuxSessionName: main`.
2. Open shell detail.
3. Tap `Browser` on the main keyboard.
4. Tap `Diff`; expected: Android default browser opens a Diffity URL.
5. Tap `URL`, `Web`, `Story`, and `App` for slots already present in `tmux-config.toml`; expected: Android default browser opens the saved URL.
6. In a folder without a saved slot, tap `Web`; expected: native modal appears, `Save & Open` writes `tmux-config.toml`, then opens the URL.
7. Open the advanced keyboard and tap `Set Web`; expected: native modal opens prefilled, `Save` updates `tmux-config.toml` and does not open the browser.
8. Tap `Status` on the main keyboard three times; expected: tmux status cycles normal -> `🕒` -> `💤` -> normal.

- [ ] **Step 7: Commit any final mobile fixes**

If Task 7 required fixes in `/home/muly/fressh`, commit them:

```bash
git add apps/mobile/src apps/mobile/config/shell-config.json apps/mobile/test/integration
git commit -m "fix(mobile): finalize host browser keyboard actions"
```

Expected: no commit is created if no fixes were needed after prior task commits.
