# Browser Menu URL Set Mode Design

## Context

The mobile `Browser` key now opens a Browser action menu. The menu includes
repository actions (`Diff`, `GitHub Issues`, `GitHub Pull Requests`) and saved
URL slots (`URL`, `Web`, `Story`, `App`).

Current saved URL behavior is split across two surfaces:

- tapping a URL slot in the Browser menu opens it;
- long-pressing a URL slot in the Browser menu edits it;
- the Advanced keyboard still has separate `Set URL`, `Set Web`, `Set Story`,
  and `Set App` keys.

The desired model is one consolidated Browser menu where users can quickly
switch the URL slot rows between opening URLs and setting URLs. Android URL
opening must remain unchanged: mobile opens URLs through
`Linking.openURL`, not through tmux or host-browser OSC routing.

## Goals

- Keep normal tap on the main `Browser` key opening the Browser action menu.
- Add an explicit Browser menu mode control for URL slots:
  - default mode is Open;
  - tapping the mode control switches to Set mode;
  - tapping it again switches back to Open mode.
- In Open mode, preserve current URL slot behavior:
  - saved valid URL opens immediately;
  - unset URL prompts to set it, then opens after saving;
  - invalid saved URL shows the existing edit/error modal.
- In Set mode, tapping `URL`, `Web`, `Story`, or `App` opens the edit modal
  for that slot and does not open the URL after saving.
- Keep `Diff`, `GitHub Issues`, and `GitHub Pull Requests` as open actions in
  both modes.
- Remove the old individual Advanced keyboard setter keys for URL slots.
- Preserve compatibility for `browser_keyboard` and `OPEN_BROWSER_KEYBOARD`.

## Non-Goals

- Do not change how Android opens external URLs.
- Do not add tmux URL bridge behavior to mobile.
- Do not remove `browser_keyboard` or `OPEN_BROWSER_KEYBOARD` in this change.
- Do not add per-row edit buttons unless the mode toggle proves insufficient.
- Do not change saved URL validation, persistence keys, or labels.

## Approved UX

The Browser menu header gets a compact mode button. Open mode is the default
whenever the menu is opened.

In Open mode:

- the header title remains `Browser`;
- the mode button says `Set`;
- URL slot rows behave as open actions;
- static repository rows behave as open actions.

In Set mode:

- the mode button says `Open`;
- URL slot rows behave as edit actions;
- static repository rows still behave as open actions.

Long press on URL slot rows remains as an edit shortcut, but it is no longer the
primary discoverable way to edit URLs. Long press on static repository rows does
nothing special.

The unset-slot flow is intentionally asymmetric:

- Open mode plus unset slot still prompts to set and then opens, matching
  today's behavior.
- Set mode plus any URL slot opens the normal edit modal and does not auto-open
  after saving.

## Components

`BrowserActionsModal` remains the presentation component for the menu. It owns
the menu-local mode state because the mode is only relevant while this modal is
open.

The modal continues to receive callbacks for behavior:

- `onOpenDiff`
- `onOpenGitHubIssues`
- `onOpenGitHubPulls`
- `onOpenUrlSlot(slot)`
- `onEditUrlSlot(slot)`

The modal decides which URL slot callback to call from the current mode. It
does not read saved URLs, validate URLs, run repository commands, or call
`Linking.openURL` directly.

When the modal closes and later reopens, mode resets to Open. This avoids a
sticky setting state that could surprise users who come back expecting a normal
Browser tap to open URLs.

## Data Flow

The existing open-slot flow remains the only path for Open mode:

1. User taps a URL slot while mode is Open.
2. `BrowserActionsModal` closes and calls `onOpenUrlSlot(slot)`.
3. `detail.tsx` runs `handleOpenHostUrlSlot(slot)`.
4. Saved valid URLs open through the existing Android `Linking.openURL` wrapper.
5. Missing URLs open the existing set modal in `open-missing` mode and open
   after a valid submit.

Set mode uses the existing edit-slot flow:

1. User taps a URL slot while mode is Set.
2. `BrowserActionsModal` closes and calls `onEditUrlSlot(slot)`.
3. `detail.tsx` runs `handleEditHostUrlSlot(slot)`.
4. The existing edit modal opens for that slot.
5. Saving updates the slot and does not open the URL.

Static repository actions ignore the mode:

- `Diff` continues to run the mobile Diffity flow.
- `GitHub Issues` continues to resolve the current repository and open
  `https://github.com/<owner>/<repo>/issues`.
- `GitHub Pull Requests` continues to resolve the current repository and open
  `https://github.com/<owner>/<repo>/pulls`.

## Keyboard Config

Update `apps/mobile/config/shell-config.json`:

- keep the main `Browser` key mapped to `OPEN_BROWSER_ACTIONS`;
- remove `Set URL`, `Set Web`, `Set Story`, and `Set App` from
  `advanced_keyboard`;
- keep `browser_keyboard` active and unchanged for compatibility;
- keep `OPEN_BROWSER_KEYBOARD` routing intact.

Removing the Advanced setter keys is part of the consolidation. The direct
setter action IDs remain registered in code for backward compatibility with
older configs or external callers.

The config metadata must be bumped and validated as part of implementation.

## Error Handling

No new error paths are required.

Open mode reuses existing open-slot, unset-slot, invalid-slot, Diff, and GitHub
action error handling.

Set mode reuses existing edit-slot and save validation error handling. Because
Set mode saves through the normal edit path rather than the `open-missing` path,
successful saves must not trigger Android URL opening.

## Testing

Add focused tests where existing patterns support them:

- `BrowserActionsModal` defaults to Open mode when opened.
- Tapping the mode button toggles Open and Set behavior for URL slot rows.
- URL slot row tap calls `onOpenUrlSlot` in Open mode.
- URL slot row tap calls `onEditUrlSlot` in Set mode.
- Static action rows call their open callbacks in both modes.
- Existing unset-slot open-after-save behavior remains covered by current
  host URL modal tests or equivalent integration coverage.
- Keyboard config validation passes after removing the Advanced setter keys.

Manual verification on Android:

1. Tap `Browser`; the Browser action menu opens in Open mode.
2. Tap saved `URL`, `Web`, `Story`, and `App` rows; Android opens each URL.
3. Tap an unset URL slot in Open mode; the set modal appears and saving opens
   the URL.
4. Reopen `Browser`, tap `Set`, then tap each URL slot; the edit modal appears.
5. Save from Set mode; the saved URL does not automatically open.
6. In Set mode, tap `Diff`, `GitHub Issues`, and `GitHub Pull Requests`; each
   still opens the correct Android URL.
7. Open the Advanced keyboard and confirm the old individual setter keys are no
   longer present.

## Rollout

This is a JS behavior change plus a runtime shell config change. Deliver it via
the normal mobile preview OTA path after tests pass.

Users with an already-loaded runtime config may need to reload the shell config
to see the Advanced keyboard cleanup. The main Browser menu behavior is app
code-driven and follows the OTA update.
