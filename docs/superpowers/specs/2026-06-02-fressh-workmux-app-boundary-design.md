# Fressh Workmux App Boundary Design

## Context

`mulyoved/skills` PR 93 added and merged app-callable Workmux commands under
`mdev tmux app ...`. Issue 89 remains the original request for Fressh mobile to
stop calling tmux directly from non-tmux side-channel shells.

Fressh already moved Workmux attach to `mdev tmux attach`, but still has
temporary direct `tmux ...` command builders for pane context, current window
id, notification routing, and touch scrollback. The mobile keyboard also still
uses tmux-bound byte sequences for some Workmux role and workspace movement.

## Goal

Make Fressh mobile target the full issue 89 acceptance criteria:

- Fressh mobile performs Workmux actions by invoking `mdev`, not `tmux`.
- Fressh mobile does not know tmux role-window metadata, pane indexes, window
  format strings, or copy-mode command syntax.
- Remote command failures are reported as Workmux or `mdev` failures, with a
  clear update requirement for older remotes.

There is no fallback to direct tmux. Workmux-enabled mobile flows require the
remote machine to have the merged `mdev tmux app ...` command surface.

## Non-Goals

- Do not preserve legacy direct-tmux fallbacks.
- Do not add new `mdev` subcommands in this repository.
- Do not change the Rust attach boundary beyond the existing
  `mdev tmux attach` behavior unless tests reveal a regression.
- Do not hand-edit generated files.

## Architecture

Fressh treats `mdev tmux app` as the application boundary for Workmux. Mobile
code expresses semantic intents, and `mdev` owns tmux mechanics.

Mobile intents include:

- Read the active Workmux context.
- Read the active Workmux window projection.
- Route an agent notification to its Workmux window.
- Enter Workmux scrollback.
- Scroll Workmux copy-mode by page batches.
- Focus a role or move to previous/next role.
- Navigate previous/next workspace, including all-window navigation.
- Select a workspace by index when the UI exposes direct selection.
- Cycle Workmux status.

`mdev` owns target resolution, window ids, role windows, primary panes,
remembered roles, skipped or hidden windows, pane paths, pane tty values,
copy-mode entry, and scroll commands.

## Command Boundary Module

Add a focused mobile module such as
`apps/mobile/src/lib/workmux-app-commands.ts`. It should centralize shell
quoting, command construction, JSON parsing, and the TypeScript types for
remote app context.

Expected builders:

- `buildWorkmuxAppContextCommand(sessionName)`
  - `mdev tmux app context --session <session>`
- `buildWorkmuxAppWindowCommand(sessionName)`
  - `mdev tmux app window --session <session>`
- `buildWorkmuxAppNotificationOpenCommand(sessionName, windowId)`
  - `mdev tmux app notification open --session <session> --window-id <@id>`
- `buildWorkmuxAppScrollEnterCommand(sessionName)`
  - `mdev tmux app scroll enter --session <session>`
- `buildWorkmuxAppScrollPageCommand(sessionName, direction, count)`
  - `mdev tmux app scroll page-up|page-down --count <count> --session <session>`
- `buildWorkmuxAppFocusCommand(sessionName, roleOrDirection)`
  - `mdev tmux app focus <role|next|prev|toggle-git-bash> --session <session>`
- `buildWorkmuxAppNavCommand(sessionName, action, index?)`
  - `mdev tmux app nav <next|prev|next-all|prev-all|select> [index] --session <session>`

Expected parsers:

- `parseWorkmuxAppContextOutput(output)` reads exactly one JSON object with
  required fields for `sessionName`, `target`, `windowId`, `paneId`, `paneTty`,
  `panePath`, `projectRoot`, and `projectName`.
- `parseWorkmuxAppWindowOutput(output)` reads exactly one JSON object with
  required fields for `sessionName`, `target`, `windowId`, `windowIndex`, and
  `windowName`.

Bad JSON, missing fields, or multiple records are treated as remote `mdev`
contract failures.

## Mobile Flow Changes

### Host Browser And Detected Open

`apps/mobile/src/lib/shell-modals.tsx` should resolve pane path and pane context
by running `mdev tmux app context --session <name>` and parsing JSON.

`apps/mobile/src/lib/detected-open-actions.ts` may keep invoking `mdev open`
with `TMUX_PANE`, `TMUX_PANE_TTY`, and `TMUX_PANE_PATH`, but those environment
values must come from parsed `mdev tmux app context` output rather than direct
`tmux display-message`.

URL get/set commands remain `mdev tmux url ...`, still scoped with
`TMUX_PANE_PATH` from app context.

### Agent Notifications

`apps/mobile/src/lib/agent-notification-visibility.ts` should route tapped
notifications through:

```text
mdev tmux app notification open --session <session> --window-id <@id>
```

Visible-notification acknowledgement should read the current window through
`mdev tmux app window --session <session>` or app context, then acknowledge the
reported `windowId`.

Routing should continue to validate the Android tap token before sending the
remote command. If routing fails, restore the token as today and log a warning.

### Touch Scrollback

`apps/mobile/src/lib/tmux-scrollback.ts` should stop building direct
`tmux copy-mode`, `tmux send-keys -X`, and `tmux select-window` commands.

Touch scrollback entry should run:

```text
mdev tmux app scroll enter --session <session>
```

Touch scroll batches should run:

```text
mdev tmux app scroll page-up --count <n> --session <session>
mdev tmux app scroll page-down --count <n> --session <session>
```

The merged remote command supports page batches, not line batches. Fressh should
convert page counts directly. Line counts should be accumulated per direction
until they cross a fixed page threshold, then emitted as page-up or page-down
commands. Sub-page leftovers remain buffered while scrollback is active and are
cleared when scrollback exits. Fressh must not add direct tmux line-scroll
commands.

### Keyboard Actions

`apps/mobile/src/lib/keyboard-actions.ts` should add semantic Workmux action
ids instead of sending tmux key bytes for Workmux role and workspace movement.

Expected actions:

- `WORKMUX_FOCUS_CLAUDE`
- `WORKMUX_FOCUS_GIT`
- `WORKMUX_FOCUS_CODEX`
- `WORKMUX_FOCUS_BASH`
- `WORKMUX_FOCUS_PREV`
- `WORKMUX_FOCUS_NEXT`
- `WORKMUX_FOCUS_TOGGLE_GIT_BASH`
- `WORKMUX_NAV_PREV`
- `WORKMUX_NAV_NEXT`
- `WORKMUX_NAV_PREV_ALL`
- `WORKMUX_NAV_NEXT_ALL`
- `WORKMUX_NAV_SELECT_<n>` if direct workspace selection is exposed

The action context should expose a callback for running a Workmux app command
over the existing SSH side-channel. Keyboard Workmux actions are quiet on
success and show a short Workmux error on user-initiated failure.

`apps/mobile/config/shell-config.json` should stop encoding role/workspace
Workmux movement as raw tmux bytes where the new action ids cover the behavior.
Non-Workmux terminal keys such as arrows, page keys, or plain text macros can
remain bytes.

### Status Cycle

Status cycle already uses `mdev tmux nav cycle <target>`. Keep that command
unchanged in this work because it is already an `mdev` boundary and is not part
of the direct-tmux cleanup. It should not reintroduce direct tmux.

## Error Handling

Fressh requires the new remote `mdev` command surface. Missing commands or
nonzero exits should be reported as Workmux-level failures:

```text
Update mdev on the remote machine; this action requires mdev tmux app commands.
```

Use alerts only for user-initiated actions such as browser actions and keyboard
actions. Background acknowledgement remains best-effort and should warn without
showing an alert. Notification tap routing also remains log-only on failure to
avoid interrupting Android notification flow.

## Testing

Update focused tests around the new boundary:

- Host browser command tests expect `mdev tmux app context/window`, not
  `tmux display-message`.
- Parser tests validate Workmux app context/window JSON, required fields, bad
  JSON, and extra output.
- Scrollback command tests expect `mdev tmux app scroll enter/page-up/page-down`.
- Notification visibility tests expect `mdev tmux app notification open` and
  `mdev tmux app window`.
- Keyboard action tests prove Workmux role/workspace actions call side-channel
  callbacks, not `sendBytes`.
- Keyboard config tests verify Workmux controls use action ids, not tmux-bound
  byte sequences.
- `direct-tmux-boundary.test.ts` changes from an allowlist of temporary
  violations to a zero-tolerance source guard for app and runtime Rust source.

Focused verification should include:

- `pnpm --filter @fressh/mobile exec tsx --test test/integration/host-browser-actions.test.ts`
- `pnpm --filter @fressh/mobile exec tsx --test test/integration/tmux-scrollback.test.ts`
- `pnpm --filter @fressh/mobile exec tsx --test test/integration/agent-notification-visibility.test.ts`
- `pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-actions.test.ts`
- `pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-config.test.ts`
- `pnpm --filter @fressh/mobile exec tsx --test test/integration/direct-tmux-boundary.test.ts`

Run broader mobile lint or test targets if the implementation touches shared
typing, runtime config loading, or shell controller behavior.

## Rollout

1. Update `mdev` on the remote machine first so PR 93 commands are available.
2. Ship the Fressh mobile change.
3. For JSON-only keyboard config changes, publish through the normal runtime
   shell config flow.
4. For TypeScript or native changes, use the normal preview build or OTA path
   depending on whether native code changed.

Older remotes are intentionally unsupported for these Workmux actions. They
fail with the update message rather than falling back to direct tmux.
