# Android Host Browser Keyboard Actions Design

## Context

The desktop tmux and WezTerm workflow opens host browser URLs from a remote SSH
session by emitting OSC 1337 user variables through tmux passthrough. WezTerm on
Windows receives the signal and uses a Chrome DevTools Protocol helper to focus
or open a dedicated Chrome profile tab.

The React Native Android app should provide the same workflow from the mobile
terminal keyboard, but Android does not need the OSC/WezTerm path. The app
already has runtime keyboard `action` slots, a central keyboard action handler,
side-channel SSH command execution, and `Linking.openURL` for opening URLs
through the Android default handler.

## Goal

Add Android-native keyboard actions for remote dev URLs:

- Open a Diffity diff URL for the current pane's git repo.
- Open per-folder URL slots stored in the remote `tmux-config.toml`.
- Prompt natively when an open action targets a missing URL slot.
- Edit URL slots from the advanced/extras keyboard.
- Replace separate mobile status toggles with one status-cycle key.

## Non-Goals

- Do not implement OSC 1337 parsing or WezTerm-compatible user-var handling in
  the mobile app.
- Do not implement Chrome CDP tab focusing on Android.
- Do not store URL slots in app-local MMKV as the source of truth.
- Do not add an in-app browser tab system.
- Do not redesign the terminal keyboard beyond the required action keys.

## Architecture

Use React Native keyboard actions rather than terminal key emulation.

The runtime shell config adds a dedicated browser keyboard for frequent open
actions. Keyboard slots invoke new action IDs handled by `keyboard-actions.ts`
and the shell detail screen. These handlers run remote helper commands through
the existing side-channel SSH path, then open URLs with `Linking.openURL`.

Remote helper script changes are part of the feature contract. The canonical
copies live in `dev-docs/dev-env` and are installed to `~/bin` on the remote VM:

- `diffity-share` remains the URL producer for Diffity. The app parses the last
  `https://...` URL from its output.
- `tmux-window-config-url` gains non-interactive commands:
  - `get <slot>` prints the saved slot URL, if present.
  - `set-value <slot> <url>` writes the slot to `tmux-config.toml`.
- `tmux-nav.sh` gains `cycle`, which changes `@workmux_status` in this order:
  normal, parked, inactive, normal.

The remote `tmux-config.toml` remains the source of truth for URL slot values,
so desktop and Android share the same per-folder state.

## Keyboard Design

Add a dedicated browser keyboard reachable from the main keyboard through a
single navigation action.

The browser keyboard exposes frequent open actions only:

- `Back`
- `Diff`
- `URL`
- `Web`
- `Story`
- `App`

Slot mapping:

- `URL` maps to `window-url`.
- `Web` maps to `dev-web-server-url`.
- `Story` maps to `storybook-url`.
- `App` maps to `app-url`.

Move rarely used setters to the advanced/extras keyboard:

- `Set URL`
- `Set Web`
- `Set Story`
- `Set App`

Add a standalone `Status` key that replaces the current separate status-change
keys. `Status` is unrelated to browser opening and should not live on the
browser keyboard.

## URL Modal

Missing-slot prompts and explicit setter actions use a native React Native modal.

The modal has:

- A title based on the slot label.
- A single URL text input.
- `Cancel`.
- `Save & Open` when an open action prompted for a missing value.
- `Save` when launched from an explicit setter action.

Empty input plus save is a no-op and preserves the current value, matching the
desktop helper behavior. Clearing a slot remains a manual edit of
`tmux-config.toml`.

## Data Flow

### Diffity

1. The user taps `Diff`.
2. The app resolves the current tmux pane path.
3. The app runs `diffity-share` in that directory over side-channel SSH.
4. The app parses the final HTTPS URL from the helper output.
5. The app opens the URL through Android with `Linking.openURL`.

### Saved URL Slots

1. The user taps `URL`, `Web`, `Story`, or `App`.
2. The app resolves the current tmux pane path.
3. The app runs `tmux-window-config-url get <slot>` with
   `TMUX_PANE_PATH=<pane-path>`.
4. If a URL exists, the app opens it with `Linking.openURL`.
5. If the slot is missing, the app shows the native URL modal.
6. Saving a missing URL runs `tmux-window-config-url set-value <slot> <url>` and
   then opens the URL.

### Explicit Slot Editing

1. The user taps `Set URL`, `Set Web`, `Set Story`, or `Set App`.
2. The app reads the current value with `tmux-window-config-url get <slot>`.
3. The app opens the URL modal prefilled with the current value.
4. Saving runs `tmux-window-config-url set-value <slot> <url>`.
5. The app does not open the browser.

### Status Cycle

1. The user taps `Status`.
2. The app runs `tmux-nav.sh cycle` over side-channel SSH.
3. The helper updates `@workmux_status`.
4. Existing tmux status bar colors and skip-navigation behavior reflect the new
   state.

## Current Pane Path Resolution

Android needs the current remote folder for both Diffity and URL slots. The app
will resolve it with a side-channel command that asks tmux for the active pane's
`#{pane_current_path}` in the connection's configured tmux session. For the
default Fressh connection this is `main`.

The command should target the configured session explicitly instead of relying
on tmux's implicit current client. Conceptually:

```sh
tmux display-message -p -t '<tmux-session>:' '#{pane_current_path}'
```

If the connection is not using tmux or the configured session is unavailable,
the browser/status actions should show a clear unavailable message.

## Error Handling

- Missing SSH connection: show an alert and do nothing.
- Missing helper command: show which helper is missing.
- Missing URL slot on open: show the native URL modal.
- Empty modal input: no-op and preserve the current value.
- Invalid URL: block save/open with inline validation. Accept `http://` and
  `https://`.
- Diffity failure: show the helper output or stderr in a concise alert.
- Android cannot open URL: show the URL and the `Linking.openURL` error.
- Remote command construction must treat slot names as a fixed enum and shell
  quote pane paths, session names, and URLs.

## Testing

Automated coverage should include:

- Keyboard action IDs are accepted by shell config validation.
- Browser keyboard routing and advanced/extras setter placement.
- URL extraction from `diffity-share` output.
- Remote command construction and shell escaping for slot get/set commands.
- Slot open behavior: existing value opens, missing value prompts, explicit edit
  saves without opening.
- Status action dispatches the remote cycle helper.

Manual Android verification should cover:

- `Diff` opens a Diffity URL in the Android default browser.
- Each configured URL slot opens the expected URL.
- Missing slot prompt saves to remote `tmux-config.toml` and opens.
- Setter actions update `tmux-config.toml` without opening the browser.
- `Status` cycles normal, parked, inactive, and back to normal.
