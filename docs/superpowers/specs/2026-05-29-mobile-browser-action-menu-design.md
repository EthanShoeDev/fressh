# Mobile Browser Action Menu Design

## Context

The mobile terminal keyboard currently has a `Browser` key on the main phone
keyboard. A normal tap routes to `browser_keyboard`; a long press exposes
`Browser`, `Diff`, `URL`, `Web`, `Story`, and `App`.

Tmux has a broader host-browser shortcut surface:

- `Alt+d`: open Diffity for the pane repository.
- `Alt+h`: open GitHub Issues for the pane repository.
- `Shift+Alt+H`: open GitHub Pull Requests for the pane repository.
- `Alt+u`, `Alt+w`, `Alt+s`, `Alt+a`: open saved URL slots.
- `Shift+Alt+U`, `Shift+Alt+W`, `Shift+Alt+S`, `Shift+Alt+A`: set or edit
  saved URL slots.

Mobile should keep its current Android-owned behavior: actions open URLs with
React Native `Linking.openURL`. It should not emit tmux/WezTerm OSC payloads or
open the host debug Chrome.

## Goals

- Make a normal tap on the main `Browser` key open a browser action menu.
- Add GitHub Issues and GitHub Pull Requests actions to mobile.
- Keep saved URL open behavior unchanged: tapping a saved slot opens it; tapping
  an unset slot prompts to set it and then opens it.
- Move set/edit URL behavior into the new Browser menu via long press on URL
  rows.
- Keep the implementation aligned with existing modal and side-channel command
  patterns.

## Non-Goals

- Do not change mobile browser actions to use host-browser OSC or
  `mdev ... host-open`.
- Do not change generated keyboard files.
- Do not remove existing advanced `Set URL`, `Set Web`, `Set Story`, or
  `Set App` keys in this change.
- Do not remove `browser_keyboard` or `OPEN_BROWSER_KEYBOARD` routing in this
  change; they can remain as compatibility surface even if no primary key routes
  to them.

## Proposed Design

Add a new runtime action ID, `OPEN_BROWSER_ACTIONS`, handled by
`apps/mobile/src/lib/keyboard-actions.ts`. The action context in
`apps/mobile/src/app/shell/detail.tsx` gets an `openBrowserActions` callback
that closes conflicting modals and opens a new `BrowserActionsModal`.

Update `apps/mobile/config/shell-config.json` so the main phone keyboard's
`Browser` key dispatches `OPEN_BROWSER_ACTIONS` on normal tap. Remove the
current `Browser` key long-press menu because the normal tap menu becomes the
primary action surface.

The modal contains these rows, in this order:

1. `Diff`
2. `GitHub Issues`
3. `GitHub Pull Requests`
4. `URL`
5. `Web`
6. `Story`
7. `App`

The modal should visually follow the existing compact bottom-right modal pattern
used by `CommandPresetsModal` and `SkillSelectorModal`.

## Interaction

Tapping `Browser` on the main keyboard opens `BrowserActionsModal`.

Tapping `Diff` closes the menu and runs the existing mobile Diffity flow. This
continues to execute the side-channel command that produces a Diffity HTTPS URL,
then opens that URL with Android `Linking.openURL`.

Tapping `GitHub Issues` closes the menu, resolves the current pane repository,
builds `https://github.com/<owner>/<repo>/issues`, and opens it with
`Linking.openURL`.

Tapping `GitHub Pull Requests` closes the menu, resolves the current pane
repository, builds `https://github.com/<owner>/<repo>/pulls`, and opens it with
`Linking.openURL`.

Tapping `URL`, `Web`, `Story`, or `App` closes the menu and calls the existing
open-slot flow for that slot:

- if a saved URL exists and is valid, open it;
- if the saved URL is invalid, show the existing edit/error modal;
- if no URL is saved, prompt to set it and then open it after a valid submit.

Long-pressing `URL`, `Web`, `Story`, or `App` closes the menu and calls the
existing edit-slot flow for that slot. Long press on `Diff`, `GitHub Issues`,
and `GitHub Pull Requests` has no special behavior.

## Components

`BrowserActionsModal` is a focused React Native component under
`apps/mobile/src/app/shell/components`.

It receives:

- `open`
- `bottomOffset`
- `onClose`
- `onOpenDiff`
- `onOpenGitHubIssues`
- `onOpenGitHubPulls`
- `onOpenUrlSlot(slot)`
- `onEditUrlSlot(slot)`

The component owns only modal presentation and row press/long-press routing.
It does not resolve repositories, run side-channel commands, read URL slots, or
open Android URLs.

## GitHub URL Resolution

Reuse the existing pane-path and repository-resolution flow already used by the
feature request modal:

1. Resolve pane path with `resolveHostBrowserPanePath()`.
2. Run `buildResolveGitHubRepositoryCommand(panePath)` over the side channel.
3. Parse with `parseGitHubRepositoryResolutionOutput(output)`.
4. Build the target URL from the resolved `owner/repo`.

Add GitHub target URL construction helpers in
`apps/mobile/src/lib/repo-feature-request.ts`, next to the existing repository
resolution helpers. That module already owns GitHub remote parsing and
resolution output parsing.

The GitHub menu actions should not shell out to `mdev tmux github`; that command
emits host-browser OSC payloads, while mobile intentionally opens Android URLs.

## Keyboard Config

`apps/mobile/config/shell-config.json` changes:

- main `Browser` key action becomes `OPEN_BROWSER_ACTIONS`;
- main `Browser` key long-press menu is removed;
- `browser_keyboard` remains active and unchanged for compatibility;
- advanced direct setter keys remain unchanged.

The config metadata must be bumped and validated as part of implementation.

## Error Handling

GitHub actions use the same user-facing error pattern as existing host-browser
actions.

If the connection is not tmux-enabled, repository resolution fails through the
same `resolveHostBrowserPanePath()` guard used by URL and Diffity flows.

If repository resolution returns no GitHub repository, show:

- `GitHub Issues failed` for Issues;
- `GitHub Pull Requests failed` for Pull Requests.

The message should include `Could not resolve GitHub repository for current
window.`.

If Android cannot open the constructed URL, reuse the existing `openAndroidUrl`
error wrapping.

## Testing

Add or update focused tests for:

- `OPEN_BROWSER_ACTIONS` dispatch in `keyboard-actions.test.ts`;
- GitHub Issues/Pulls URL construction;
- any new helper that maps GitHub targets to paths;
- keyboard config validation after updating `shell-config.json`.

Component tests are optional unless a suitable React Native component test
pattern already exists in the repo. The main test value is in action dispatch,
URL helper correctness, and manual verification of modal gestures.

Manual verification:

1. Tap `Browser`; the Browser action menu opens.
2. Tap `Diff`; Android opens the Diffity URL.
3. Tap `GitHub Issues`; Android opens the current repository Issues page.
4. Tap `GitHub Pull Requests`; Android opens the current repository Pull
   Requests page.
5. Tap each URL slot with a saved URL; Android opens it.
6. Tap an unset URL slot; the set modal appears, saving a valid URL opens it.
7. Long-press each URL slot row; the set/edit modal opens without opening a URL.

## Rollout

This is an app/runtime behavior change plus JSON config change. It requires the
normal mobile app delivery path for code changes. The JSON-only keyboard config
reload flow is not enough because `OPEN_BROWSER_ACTIONS` and the new modal do
not exist in the current runtime.
