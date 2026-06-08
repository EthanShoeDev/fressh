# mdev Codex Restart Menu Design

## Goal

Update the mobile command menu under `Cmds > mdev` so the Codex entries match
the current desired `mdev` CLI surface:

- Keep `codex auth refresh`, which runs `mdev codex auth refresh`.
- Remove the duplicate `codex auth refresh new` entry.
- Add `restart codex`, which runs `mdev codex restart` against the Codex role
  target resolved by `mdev tmux app context`.

## Scope

This change is limited to the bundled mobile shell configuration and its
integration coverage. It does not add a native action type, change command menu
rendering, change remote command execution, or modify the `mdev` CLI.

## Command Menu Behavior

The `mdev` submenu should keep the existing workspace entries and feature
request action unchanged. Its Codex command entries should become:

- `codex auth refresh`: text `mdev codex auth refresh`, then Enter.
- `restart codex`: text
  `mdev codex restart "$(mdev tmux app context --session main | sed -n 's/.*"target":"\\([^"]*\\)".*/\\1/p')"`,
  then Enter.

The removed `codex auth refresh new` label should not appear in the bundled menu
tree.

## Data Flow

The command menu continues to load from `apps/mobile/config/shell-config.json`.
Selecting either Codex preset inserts the configured text into the active shell
and sends Enter through the existing command preset runner.

## Error Handling

No new app-side error handling is needed. If the resolved-target
`mdev codex restart` command fails, the remote shell shows the command output
using the existing preset execution path.

## Testing

Update the existing command menu integration tests so they assert:

- `codex auth refresh new` is absent from the `mdev` submenu.
- `codex auth refresh` still sends `mdev codex auth refresh`.
- `restart codex` sends `mdev codex restart` with the Codex role target resolved
  from `mdev tmux app context`.
