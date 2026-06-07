# Tmux Narrow Status Focus Design

## Context

Fressh mobile renders the remote tmux session through xterm.js inside a
WebView. Terminal resizing is already propagated from xterm to React Native and
then to the SSH PTY.

The failing case is specific to tablet portrait:

- Desktop client: `201x47`, status bar shows the useful Workmux windows.
- Tablet landscape: status bar is acceptable.
- Tablet portrait: mobile client is about `76x49`, and the tmux status line
  shows only the left overflow marker `<`.

The useful visible Workmux windows are few enough to fit in portrait. The
problem is not label length or terminal font size.

Live tmux inspection showed the active mobile window can be a high-index role
window such as `main:1173 fressh-codex`. The Workmux status format intentionally
renders role windows as empty so the status bar exposes workspace windows, not
internal role windows. Tmux still treats the active role window as the window
list focus. On narrow clients, tmux scrolls the window list to keep that empty
active-window slot visible, pushing the useful workspace labels off-screen.

## Goal

Keep the existing Workmux status-bar semantics and labels, but stop tablet
portrait from scrolling the status list to a hidden role window.

The portrait status bar should keep the useful workspace tabs visible instead
of showing only `<`.

## Non-Goals

- Do not redesign the Workmux status bar.
- Do not change which windows are considered visible.
- Do not add a native mobile status overlay.
- Do not shrink the terminal font or otherwise change xterm layout to create
  more columns.
- Do not expose role windows as independent status tabs.

## Design

Change the low-level tmux `status-format[0]` focus placement while preserving
the existing `window-status-format` and `window-status-current-format` content.

Tmux's default `status-format[0]` marks the current window item with
`list=focus`. When the full list does not fit, tmux scrolls the status window
list to keep that focused item visible. For Workmux, the current tmux window can
be a hidden role window whose status label is intentionally empty.

The adjusted status format should choose the focus item as follows:

1. If the current window is a normal workspace window, keep the default behavior:
   focus the current window.
2. If the current window is a role window, focus the parent workspace window
   instead of the role window.
3. If the parent workspace cannot be determined, fall back to the default
   current-window focus.

This keeps desktop and tablet landscape visually equivalent while preventing
portrait from anchoring the list to an empty high-index role window.

## Data Sources

Use existing Workmux tmux metadata:

- `@mdev_role_window` identifies internal role windows.
- `@mdev_workspace_id` identifies the workspace for both workspace and role
  windows.
- `@mdev_current_workspace_id` tracks the active workspace.
- Existing `window-status-format` and `window-status-current-format` continue to
  decide what text is rendered for each window.

No new mobile app state is needed.

## Error Handling

If the focus calculation cannot identify a parent workspace, tmux should keep
the default current-window focus. A bad or missing Workmux option must not blank
the status bar or hide windows that were previously visible.

The implementation should be easy to roll back by restoring the default
`status-format[0]` focus placement.

## Testing

Verify both the tmux-level behavior and the actual mobile rendering:

- In a wide desktop client, confirm the status bar remains visually unchanged.
- In tablet landscape, confirm the current status bar behavior remains
  acceptable.
- In tablet portrait, confirm the status bar no longer shows only `<` and keeps
  useful workspace tabs visible.
- With the active pane in a role window such as `fressh-codex`, confirm the
  status list focuses the parent workspace tab.
- With missing or malformed Workmux metadata, confirm tmux falls back to the
  default current-window focus.

## Rollout

Apply the change in the Workmux tmux configuration that owns the active status
format. Source the config into the running tmux server, then verify desktop,
tablet landscape, and tablet portrait before making any mobile app changes.
