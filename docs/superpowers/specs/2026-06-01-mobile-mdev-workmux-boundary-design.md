# Mobile mdev Workmux Boundary Design

## Context

PRs mulyoved/skills#87 and mulyoved/skills#88 changed Workmux from a visible
four-pane tmux layout to role-addressed full-screen tmux windows. The new
runtime behavior is owned by `mdev`:

- `mdev tmux focus <claude|git|codex|bash|next|prev|toggle-git-bash>` owns role
  focus and legacy pane fallback.
- `mdev tmux nav <prev|next|prev-all|next-all>` owns workspace navigation.
- `mdev tmux nav select <index>` owns direct workspace selection and last-role
  restoration.
- `mdev tmux nav cycle [target]` owns Workmux status cycling.

The mobile app still has places that either send tmux-bound key sequences or
construct direct `tmux ...` command strings. The app should no longer treat
tmux as its contract. Its contract is `mdev`.

## Goal

Make the mobile app use `mdev` as the Workmux boundary wherever an existing
wrapper is available, and document the remaining direct-tmux usages as
temporary violations that require a separate `mdev` issue.

The app must not add new direct `tmux` logic as part of this work.

## Non-Goals

- Do not add new `mdev` subcommands in this repository.
- Do not solve missing `mdev` wrappers in the mobile app by parsing tmux
  metadata or role-window internals.
- Do not remove existing scrollback, browser, or notification behavior until
  replacement `mdev` wrappers exist.
- Do not change generated files by hand.

## Architecture

Mobile emits semantic Workmux intent. `mdev` owns tmux mechanics.

The intended boundary is:

- Mobile UI and keyboard actions express intent: focus role, cycle role,
  navigate workspace, select workspace, cycle status, attach Workmux session,
  read context, route notifications, and enter or drive scrollback.
- Mobile translates supported intents to `mdev` commands through existing app
  command paths.
- `mdev` owns role windows, legacy pane fallback, workspace metadata, last-role
  restoration, hidden role windows, status mirroring, window IDs, pane paths,
  target resolution, and direct tmux command construction.
- Any remaining direct `tmux ...` command in mobile is an explicitly tracked
  temporary violation, not a pattern to extend.

## Existing mdev Coverage

Use these wrappers in the app where they match existing behavior:

- `mdev tmux attach [session]`
- `mdev tmux focus <claude|git|codex|bash|next|prev|toggle-git-bash>`
- `mdev tmux nav <prev|next|prev-all|next-all>`
- `mdev tmux nav select <index>`
- `mdev tmux nav cycle [target]`
- `mdev tmux notifications listen --session <name> [--since-id <id>]`
- `mdev tmux pane project [target]`
- `mdev tmux url get <slot>`
- `mdev tmux url set-value <slot> <url>`

## Missing mdev Surface

Create a GitHub issue in `mulyoved/skills` for the missing wrappers. That issue
is a separate task and should cover:

- A stable command for current visible window id, used by notification
  acknowledgement.
- A stable command for current pane context/path, used by Browser actions,
  GitHub actions, `mdev open`, and URL storage.
- A stable command for selecting or routing to a notification target.
- Stable commands for entering scrollback copy mode and sending scrollback
  page/line batches.

Until that issue is implemented, these app areas may keep their existing direct
tmux calls, but they must be named as temporary violations in code comments or
tests when touched.

## Mobile Changes

### Rust Shell Startup

Change `startShell({ useTmux: true })` from executing:

```text
tmux attach -t <session>
```

to:

```text
mdev tmux attach <session>
```

Keep the existing attach-failure path, but user-facing copy should move toward
Workmux language when touched. For example, prefer "Workmux session not found"
over "Tmux session not found".

### Keyboard Runtime

The keyboard should stop presenting role navigation as "Pane" or ordinary
tmux-window movement.

Replace tmux-layout labels and raw tmux-key assumptions with Workmux labels and
semantic actions where existing `mdev` commands support them:

- Role focus or cycling should use `mdev tmux focus ...`.
- Workspace navigation should use `mdev tmux nav ...`.
- Direct workspace selection, if exposed, should use `mdev tmux nav select`.
- Status cycling should continue using `mdev tmux nav cycle`.

The exact grid can remain compact, but the visible model should be role and
workspace based. A suitable phone keyboard direction is:

- Primary key: `Role`
- Role long-press options: `Claude`, `Git`, `Codex`, `Bash`, `Prev role`,
  `Next role`
- Workspace key: `Work`
- Workspace long-press options: `Prev work`, `Next work`, `Prev all`,
  `Next all`

If a keyboard action needs to run an `mdev` command over SSH, add an app action
that delegates to the existing side-channel command runner rather than encoding
the command as raw typed text.

### Existing Helper Code

Keep using existing `mdev` helpers:

- Browser URL get/set remains `mdev tmux url ...`.
- Workmux status cycle remains `mdev tmux nav cycle ...`.
- Notification listening remains `mdev tmux notifications listen ...`.

Do not replace direct tmux gaps with more mobile-side tmux logic. These remain
temporary until the separate `mdev` issue is implemented:

- `tmux display-message` for current pane path/context.
- `tmux display-message` for current window id.
- `tmux select-window` for notification routing.
- `tmux copy-mode` and `tmux send-keys -X` for touch scrollback.

## Error Handling

- `mdev` command failures should surface as Workmux or app-level failures, not
  as app-owned tmux failures.
- Keyboard Workmux actions should be quiet on success.
- If a keyboard Workmux action fails, show a short alert with the `mdev` command
  failure message.
- If a command requires a Workmux-enabled connection, keep the current guard but
  prefer Workmux language in touched copy.
- Missing-wrapper areas should not gain new user-visible errors in this task.

## Testing

Add or update coverage for:

- Rust shell startup executing `mdev tmux attach <session>` for tmux-enabled
  shells.
- TypeScript command builders or actions for `mdev tmux focus` and
  `mdev tmux nav`.
- Keyboard config tests for role/workspace labels and action IDs.
- Action dispatch tests proving Workmux keyboard actions call the app command
  path instead of sending raw tmux key sequences.
- A guard test that rejects new direct `tmux ` command builders in app code
  outside the explicitly named temporary-violation files.

Existing tests for temporary direct tmux helpers may stay, but when touched they
should make clear that the behavior is pending the separate `mdev` issue.

## Rollout

1. File the `mulyoved/skills` GitHub issue for missing `mdev` wrappers.
2. Switch mobile code that already has an existing `mdev` wrapper.
3. Update keyboard config and tests.
4. Run focused mobile and Rust tests.
5. For JSON-only keyboard config changes, publish through the normal
   `shell-config.json` flow. Runtime code changes require the normal mobile app
   build/update workflow.
