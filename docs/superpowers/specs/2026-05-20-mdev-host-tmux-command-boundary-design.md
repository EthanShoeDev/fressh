# Mdev Host/Tmux Command Boundary Design

## Context

Fressh mobile exposes terminal keyboard actions that execute helper commands on
the connected host over a side-channel SSH command. The active phone keyboard's
`Status` key currently keeps the same runtime action,
`CYCLE_WORKMUX_STATUS`, and that action calls a command builder that emits
`tmux-nav.sh cycle '<session>:'`.

The new `mdev` executable now owns the host/tmux helper surface that overlaps
with several existing command builders:

- `mdev tmux nav <prev|next|cycle> [target]`
- `mdev tmux url <open|set|get|set-value> <slot> [url]`
- `mdev diffity <share|host-open> [base-ref]`
- `mdev host focus-or-open <url-or-payload>`

This change moves the app to the `mdev` command boundary where the app
already shells out to equivalent host utilities.

## Goals

- Replace legacy host/tmux helper command strings with `mdev` equivalents.
- Preserve the current mobile user experience and app-owned control flow.
- Keep behavior deterministic: if `mdev` is missing on the remote host, the
  action fails through the existing side-channel error handling.
- Avoid keyboard config, schema, generated file, or UI behavior changes.

## Non-Goals

- Do not add fallback commands for legacy utilities.
- Do not change the `Status` key definition in
  `apps/mobile/config/shell-config.json`.
- Do not move URL prompts from the mobile modal into tmux command prompts.
- Do not replace tmux control-shell scrollback behavior unless `mdev` grows an
  equivalent command in a later change.

## Proposed Design

Use `mdev` as the host/tmux command boundary in
`apps/mobile/src/lib/host-browser-actions.ts`.

Keep the mobile app responsible for:

- validating URL text
- showing the existing URL modal
- opening URLs with `Linking.openURL`
- resolving the active tmux pane path when the app needs a working directory
- side-channel SSH execution and error display

Replace only the legacy utilities that have direct `mdev` equivalents:

| Current builder | Current command | New command |
| --- | --- | --- |
| `buildHostBrowserStatusCycleCommand` | `tmux-nav.sh cycle '<session>:'` | `mdev tmux nav cycle '<session>:'` |
| `buildTmuxWindowConfigGetCommand` | `TMUX_PANE_PATH='<path>' tmux-window-config-url get '<slot>'` | `TMUX_PANE_PATH='<path>' mdev tmux url get '<slot>'` |
| `buildTmuxWindowConfigSetCommand` | `TMUX_PANE_PATH='<path>' tmux-window-config-url set-value '<slot>' '<url>'` | `TMUX_PANE_PATH='<path>' mdev tmux url set-value '<slot>' '<url>'` |
| `buildDiffityShareCommand` | `cd '<path>' && diffity-share` | `cd '<path>' && mdev diffity share` |

`buildHostBrowserPanePathCommand` remains as-is. The app needs a
plain pane path to drive existing URL modal and Diffity flows, and `mdev` does
not currently expose a narrower direct replacement for that query.

The tmux control scrollback commands in `apps/mobile/src/lib/tmux-scrollback.ts`
and `apps/mobile/src/app/shell/detail.tsx` also remain as-is. They use
the tmux control shell for copy-mode and scroll batching, and `mdev` does not
currently expose equivalent commands.

## Data Flow

The `Status` keyboard flow remains:

1. User taps `Status`.
2. Keyboard runtime dispatches `CYCLE_WORKMUX_STATUS`.
3. `handleCycleWorkmuxStatus` verifies the connection is tmux-enabled.
4. The app resolves the target session name, defaulting to `main`.
5. The side-channel command executes `mdev tmux nav cycle '<session>:'`.
6. Existing error UI shows `Status cycle failed` if the command fails.

The browser URL key flow remains:

1. User taps a browser URL key.
2. The app resolves the pane path with tmux.
3. The app reads or writes the selected URL slot using `mdev tmux url`.
4. The app keeps using the current modal and Android URL opening behavior.
5. Existing slot-specific error UI handles failures.

The Diffity key flow remains:

1. User taps `Diff`.
2. The app resolves the pane path with tmux.
3. The side-channel command executes `cd '<path>' && mdev diffity share`.
4. The app extracts the last HTTPS URL from output and opens it on Android.
5. Existing `Diffity failed` error UI handles failures.

## Error Handling

There is no fallback path. If `mdev` is not installed on the remote host,
or if it exits with an error, the existing side-channel execution layer returns
that failure and the current UI surfaces it.

Existing timeout behavior remains unchanged:

- status cycle: `10_000`
- URL read/write: `10_000`
- Diffity share: `60_000`

Existing error titles remain unchanged:

- `Status cycle failed`
- `<slot> failed`
- `Edit <slot> failed`
- `Diffity failed`

## Testing

Add or update focused unit coverage for the command builders in
`apps/mobile/src/lib/host-browser-actions.ts`.

Minimum assertions:

- `buildHostBrowserStatusCycleCommand('main')` returns
  `mdev tmux nav cycle 'main:'`.
- URL get/set command builders include `TMUX_PANE_PATH=<quoted path> mdev tmux
  url ...`.
- Diffity command returns `cd <quoted path> && mdev diffity share`.
- shell quoting remains correct for paths, sessions, slots, and URLs containing
  spaces or single quotes.

Verification includes the targeted mobile test for this module. If no
narrow test exists, add one and run the package's relevant test/typecheck target.
