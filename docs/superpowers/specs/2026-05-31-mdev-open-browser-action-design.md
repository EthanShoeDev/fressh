# Mdev Open Browser Action Design

## Context

The latest `dev-env/tmux.conf` in `/home/muly/skills` changed the `Alt+a`
shortcut from opening a saved `app-url` slot to detected-open behavior:

- `Alt+a` runs `mdev open auto`.
- `Shift+Alt+A` runs `mdev open pick`.

Fressh still exposes an `App` browser action backed by the saved `app-url`
slot. That no longer matches the current tmux shortcut model. The mobile
browser action surface should replace `App` with detected-open behavior.

## Goal

Replace the visible `App` browser action with first-class `Open` and `Pick`
actions:

- `Open` triggers the mobile equivalent of `Alt+a`: `mdev open auto`.
- `Pick` triggers the mobile equivalent of `Shift+Alt+A`: `mdev open pick`.

The existing saved URL actions for generic URL, dev web server, and Storybook
remain unchanged.

## Non-Goals

- Do not redesign the browser action modal.
- Do not remove the entire `app-url` type if doing so creates broad migration
  churn. It only needs to disappear from visible browser action surfaces.
- Do not change tmux navigation, pane switching, or scrollback behavior.
- Do not add a separate raw byte shortcut for this feature.

## Architecture

Use the existing host-browser action path rather than keyboard byte macros:

- `apps/mobile/src/lib/browser-actions.ts` owns browser action row definitions
  and press intent mapping.
- `apps/mobile/src/app/shell/components/BrowserActionsModal.tsx` renders and
  dispatches the selected row.
- `apps/mobile/src/app/shell/detail.tsx` already coordinates modal actions and
  side-channel shell execution.
- `apps/mobile/src/lib/host-browser-actions.ts` should own shell command
  builders for `mdev open auto` and `mdev open pick`.

The visible browser action rows should become:

- Static rows: `Diff`, `GitHub Issues`, `GitHub Pull Requests`, `Open`, `Pick`.
- URL rows: `URL`, `Web`, `Story`.

The `App` row should be removed from `BROWSER_ACTION_ROWS` and from the bundled
`browser_keyboard` config.

## Data Flow

1. User opens the browser action modal or browser keyboard.
2. User taps `Open` or `Pick`.
3. The browser action row maps to a typed intent:
   - `open-detected-auto`
   - `open-detected-pick`
4. `detail.tsx` resolves active tmux pane context and executes the side-channel
   command.
5. `mdev` performs host-browser opening from the remote tmux context.

Pane context should be resolved in one tmux side-channel read so the values come
from the same active pane:

```bash
tmux display-message -p -t '<session>:' '#{pane_id}	#{pane_tty}	#{pane_current_path}'
```

The parser should reject empty or malformed output before building an open
command.

The command builder should produce commands equivalent to upstream tmux:

```bash
TMUX_PANE='<pane id>' TMUX_PANE_TTY='<pane tty>' TMUX_PANE_PATH='<pane path>' mdev open auto
TMUX_PANE='<pane id>' TMUX_PANE_TTY='<pane tty>' TMUX_PANE_PATH='<pane path>' mdev open pick
```

Dynamic values must be shell-quoted with the existing `quoteShell` helper.

## Error Handling

If pane context cannot be resolved, Fressh should use the existing browser
action error reporting path and avoid sending a partial command.

If `mdev open auto` or `mdev open pick` fails, Fressh should surface the command
failure through the same modal/toast style already used by host browser actions.
This change should not introduce a new error UI.

`mdev open pick` may perform interactive selection remotely. Fressh is only
responsible for launching the command and reporting command failure.

## Testing

Add focused integration tests for:

- `BROWSER_ACTION_ROWS` includes `Open` and `Pick`.
- `BROWSER_ACTION_ROWS` no longer includes `App`.
- `BROWSER_ACTION_URL_ROWS` includes only `window-url`,
  `dev-web-server-url`, and `storybook-url`.
- Browser action intent mapping returns the two new detected-open intents.
- Host command builders quote `TMUX_PANE`, `TMUX_PANE_TTY`, and
  `TMUX_PANE_PATH`.
- Browser modal/controller wiring dispatches `Open` and `Pick` to the new
  action handlers.
- Bundled `shell-config.json` no longer exposes `OPEN_HOST_URL_APP` in
  `browser_keyboard`.

## Implementation Notes

Keep the change narrow. The important compatibility point is user-visible
behavior: the mobile browser surface should match the latest tmux shortcuts.
Low-level `app-url` support can remain if existing settings, tests, or helper
types still reference it.
