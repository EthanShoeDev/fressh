# Mobile Terminal Manual Reflow POC Design

## Overview

When a Workmux/tmux session has been active in a wide terminal, the mobile app
can later show wide terminal lines on a narrow portrait screen. The app already
fits xterm.js to the mobile viewport and sends `resizePty(cols, rows)` to the
SSH channel, but that does not rewrite bytes that were already emitted into
Fressh's shell replay buffer or tmux pane history.

This POC adds a manual reflow action. The user explicitly asks the mobile app to
rebuild the current terminal view from a bounded tmux pane snapshot, locally
wrapped to the current mobile width. The goal is to learn whether this produces
a useful mobile reading experience before deciding whether any part should
become automatic.

## Goals

- Add a manual action that reflows the active Workmux pane for the current mobile
  terminal width.
- Include the visible pane plus recent history, not just future output.
- Avoid changing the shared tmux window size when a desktop and mobile client
  are connected at the same time.
- Keep the POC bounded, reversible, and easy to remove or replace.
- Verify with a real tmux session before considering automatic behavior.

## Non-Goals

- Do not automatically reflow on every device resize, rotation, app resume, or
  focus change.
- Do not use `tmux resize-window` as the default POC behavior because it can
  globally narrow the shared tmux window.
- Do not implement tmux control mode in this POC.
- Do not guarantee full terminal styling, alternate-screen state, cursor state,
  or application-specific redraw fidelity.
- Do not clear remote tmux history or mutate the remote pane.

## User Experience

Expose the POC as one manual command in the existing `Cmds` command menu. The
label is `Reflow terminal`. A dedicated keyboard key can be considered later if
the POC proves useful.

When selected:

1. The app determines the latest xterm size reported by the WebView.
2. The app asks the Workmux/tmux side channel for the active pane's recent
   content using `tmux capture-pane -J`.
3. The app locally wraps the captured text to the current xterm column count.
4. The app clears the mobile xterm view and writes the rebuilt snapshot.
5. The live shell listener continues from the current stream so future output
   still appears normally.

The action should be silent on success. On failure, show a small user-facing
error through the existing modal/alert pattern and log the detailed cause.

## Architecture

### Capture Boundary

Use a side channel or Workmux control path rather than writing commands into the
interactive pane. The command should target the active pane in the configured
Workmux session and run something equivalent to:

```sh
tmux capture-pane -J -p -t "$pane_id" -S -300 -E -
```

Use 300 logical lines for the first POC. This is enough to test recent history
without large memory or latency surprises.

`-J` is important because it joins tmux-wrapped lines before the mobile client
wraps them again. This gives the narrow view a chance to reorganize long lines
instead of preserving the wide client's wrap points.

### Rebuild Boundary

Add a small mobile-side module that converts a captured text snapshot into bytes
for xterm. The POC should start with plain text behavior:

- normalize line endings to `\r\n`;
- hard-wrap long lines to the current `cols`;
- preserve existing newlines from tmux capture;
- trim trailing empty viewport filler lines if they produce distracting blank
  output.

The module should not know about React state, SSH shells, WebViews, or Workmux
transport. It should be testable as a pure formatter.

### Terminal Integration

`detail.tsx` already owns:

- latest shell and connection handles;
- the Workmux control channel;
- the xterm WebView ref;
- the latest terminal resize callback.

It should own the POC orchestration:

1. Store the most recent `{ cols, rows }` from `handleTerminalResize`.
2. Resolve the active Workmux pane using the existing Workmux app context path,
   which already exposes `paneId`.
3. Capture the bounded pane snapshot through the control channel.
4. Call `xterm.clear()`.
5. Write the formatted snapshot bytes.
6. Keep the existing live listener attached.

During capture/rebuild, buffer live chunks locally and flush them after the
snapshot write. This avoids visibly interleaving live output with the rebuilt
snapshot.

## Data Flow

```text
User taps Reflow terminal
  -> detail.tsx reads latest cols/rows
  -> Workmux/tmux side channel resolves active pane
  -> tmux capture-pane -J returns recent text
  -> formatter wraps text to cols
  -> xterm clear + write snapshot
  -> normal live listener continues
```

This is intentionally local to the mobile client. The remote tmux session should
not change its `window-size`, pane dimensions, or active client selection as part
of the POC.

## Error Handling

- If there is no active SSH connection, fail with `No SSH connection available`.
- If the connection is not Workmux/tmux-enabled, fail with `Reflow requires a
  Workmux session`.
- If terminal dimensions are unknown, call `fit()` once and ask the user to try
  again if dimensions are still unavailable.
- If capture returns empty output, clear nothing and report that no pane content
  was captured.
- If the side channel command fails, keep the current terminal view unchanged.

## Testing

Add focused tests for the pure formatter:

- wraps a long line to a narrow column count;
- preserves explicit newlines;
- normalizes output to terminal-friendly CRLF line endings;
- ignores invalid or tiny column counts with a defensive minimum.

Add focused tests for the tmux command builder if a new helper is introduced:

- quotes pane/session targets safely;
- rejects newline-containing targets;
- uses `capture-pane -J`;
- applies the bounded history range.

Manual verification for the POC:

1. Open the same Workmux session in a wide desktop client and in mobile portrait.
2. Produce long output in the wide client.
3. Confirm mobile initially shows the wide layout problem.
4. Tap `Reflow terminal`.
5. Confirm mobile shows visible pane plus recent history wrapped to portrait
   width.
6. Confirm desktop layout is not narrowed or otherwise disturbed.
7. Produce more output after reflow and confirm mobile continues receiving live
   output.

## POC Evaluation Questions

- Whether plain-text snapshots are good enough for Codex/tooling sessions, or
  whether we need `capture-pane -e` to preserve attributes.
- Whether the rebuilt snapshot should include a subtle separator before live
  output resumes.
- Whether the command should graduate from the command menu into a dedicated
  keyboard key.

These questions should be answered by testing the POC before designing automatic
reflow behavior.
