# Noninteractive Mdev Command Transport Design

## Summary

Fressh mobile should execute app-level Workmux commands through a
noninteractive SSH command transport, not through terminal shell channels. The
interactive terminal remains for the user-visible shell only. Machine commands
such as `mdev tmux app window` and `mdev tmux notifications listen` should run
without a PTY, prompt, shell echo, login banners, bracketed-paste control
sequences, or terminal escape bytes.

This fixes the current notification listener failure where JSONL heartbeats are
prefixed by terminal control text and rejected as malformed. It also completes
the issue 89 boundary: mobile calls `mdev tmux app ...` as the stable contract
and does not parse tmux metadata, invoke `tmux` directly, or call
`invoke-rc.bash`.

## Goals

- Add a native noninteractive SSH command API for one-shot commands.
- Add a native streaming command API for long-lived stdout streams.
- Route mobile Workmux commands through a shared remote command runner.
- Keep stdout, stderr, exit status, close events, cancellation, and timeout
  behavior separate and observable.
- Preserve the existing update-required message when `mdev` or
  `mdev tmux app` is missing or too old.
- Remove tracked temporary direct tmux helpers and prevent new direct
  `tmux`/`invoke-rc.bash` app-command paths.

## Non-Goals

- Do not change the user-visible interactive terminal attach behavior.
- Do not change the `mdev tmux app` command contract introduced by the remote
  `mdev` work.
- Do not add new notification screens or persistent health UI.
- Do not solve notification delivery after Android stops the app/service or SSH
  is disconnected.

## Architecture

`react-native-uniffi-russh` should expose command execution separately from
terminal shells:

- A one-shot command API for commands that complete and return output.
- A streaming command API for long-lived commands that emit stdout lines.
- Both APIs should use SSH session exec channels without requesting a PTY.
- stdout and stderr should be delivered separately.
- Exit status, remote close, local cancellation, and timeout should be
  represented explicitly.
- If the remote needs a shell to resolve `mdev` on `PATH`, the runner may wrap
  commands in a controlled noninteractive login shell. That wrapper must still
  use an exec channel without a PTY and must not emit prompts, command echo, or
  terminal control sequences.

Mobile should add a small remote command runner around that native API. It owns
common behavior for:

- command execution timeouts,
- cancellation and cleanup,
- stdout/stderr/exit handling,
- `mdev tmux app` failure formatting,
- JSON stdout parsing diagnostics, and
- streaming stdout line splitting.

Feature code should keep building domain commands through existing command
builders, but should execute those commands through the runner rather than
opening hidden shell channels.

## Data And Control Flow

### One-Shot Workmux Commands

1. A UI/controller requests a Workmux action such as focus, nav, context,
   current window, notification open, or scrollback entry/exit.
2. The feature builds an `mdev tmux app ...` command with the existing builder.
3. The remote command runner executes it through the native noninteractive exec
   API.
4. The runner returns clean stdout, stderr, and exit metadata.
5. The feature parses stdout when the command promises JSON.
6. Missing or old `mdev tmux app` failures map to the update-required message.
7. Other failures preserve useful stderr/output for the user or logs.

### Notification Listener

1. `AgentNotificationBridgeManager` starts a streaming exec command:
   `mdev tmux notifications listen --session <session>`.
2. Native code emits stdout chunks and stderr chunks separately.
3. Mobile splits stdout into complete lines and parses JSONL status and
   heartbeat lines.
4. Heartbeats update bridge health without prompt/control-text contamination.
5. stderr is logged separately and can explain startup or runtime failures.
6. Existing stale-heartbeat and restart backoff logic remains in the bridge
   manager, but it restarts command streams instead of interactive shells.

Prompt text in a notification stream is a transport bug. The parser may ignore
empty lines defensively, but it should not depend on stripping terminal prompts
or shell startup output.

## Error Handling And UX

No new screens are required.

If `mdev`, `tmux app`, or a required app subcommand is missing or too old, show:

`Update mdev on the remote machine; this action requires mdev tmux app commands.`

If a command exits nonzero with useful stderr/stdout, apply the existing Workmux
failure formatter and surface the resulting message. If a JSON command returns
malformed stdout, log sanitized stdout and stderr so debugging can distinguish:

- command failed,
- old or missing `mdev`,
- malformed JSON,
- no matching pending notification, and
- remote command timeout or cancellation.

Notification listener failures should degrade only the notification bridge. The
terminal remains usable. If the restart budget is exhausted, notifications are
unavailable until the bridge can restart, but terminal interaction continues.

Visible-window acknowledgement remains best-effort. It should not interrupt the
terminal when it fails, but logs must include enough context to identify command
failure versus malformed output.

## Code Impact

Native SSH package:

- Add command exec and streaming exec APIs in
  `packages/react-native-uniffi-russh`.
- Expose generated TypeScript types for command output, stderr, exit, close,
  timeout, and cancellation.
- Keep terminal shell APIs unchanged for interactive sessions.

Mobile command infrastructure:

- Add a shared remote command runner in `apps/mobile/src/lib`.
- Move `ssh-jsonl-listener` away from `startShell`, or replace it with a
  streaming command listener using the new runner.
- Move shell-based side-channel Workmux execution to the one-shot runner.
- Centralize `mdev tmux app` failure formatting at the runner boundary.

Workmux features:

- Notification listener uses streaming exec.
- Visible-window acknowledgement uses one-shot exec for
  `mdev tmux app window`.
- Browser/GitHub/context flows use one-shot exec for
  `mdev tmux app context`.
- Notification tap routing uses one-shot exec for
  `mdev tmux app notification open`.
- Scrollback uses one-shot exec for `mdev tmux app scroll ...`.
- Keyboard focus/nav uses one-shot exec for `mdev tmux app focus/nav`.

Removed or narrowed code:

- Hidden interactive shell command execution should no longer be the app-level
  Workmux transport.
- Tracked temporary direct tmux helpers and `invoke-rc.bash` paths should be
  deleted or excluded from app command flows.

Likely regression surface:

- command timeout/cleanup behavior,
- command error messages,
- notification bridge restarts,
- scrollback batching latency,
- keyboard focus/nav ordering, and
- browser/context flows that expect JSON output.

## Contract Impact

Native API contracts change by adding command execution primitives. Existing
shell contracts remain.

Mobile command contracts become stricter:

- machine-command stdout is parsed as command output only,
- stderr is diagnostic/failure output,
- exit status controls success/failure,
- streaming JSONL uses stdout only, and
- prompt/control text is invalid for machine streams.

Remote command contracts remain the `mdev` contracts from issue 89 and PR 93.
Mobile should not regain direct knowledge of tmux format strings, pane indexes,
role-window metadata, or tmux keybinding internals.

## Testing

Native tests should cover:

- one-shot stdout, stderr, and exit status separation,
- nonzero exit reporting,
- streaming stdout delivery,
- stderr delivery during streams,
- cancellation closing the channel,
- timeout abort behavior, and
- no PTY/prompt output for exec channels.
- optional noninteractive login-shell wrapping still produces clean stdout,
  separated stderr, and reliable exit status.

Mobile tests should cover:

- command runner success and failure paths,
- update-required formatting for old/missing `mdev tmux app`,
- JSON stdout parse failures with useful diagnostics,
- notification listener using streaming exec instead of `startShell`,
- heartbeat/status JSONL parsing from clean stdout,
- stderr logging for notification streams,
- restart on stream exit or stale heartbeat,
- visible-window acknowledgement through `mdev tmux app window`,
- keyboard focus/nav through `mdev tmux app focus/nav`,
- scrollback through `mdev tmux app scroll`, and
- context flows through `mdev tmux app context`.

Add static regression checks that app command code does not build direct
`tmux display-message`, `tmux send-keys`, `tmux copy-mode`, direct tmux helper
scripts, or `invoke-rc.bash` calls.

## Migration Plan

1. Add the native noninteractive one-shot and streaming exec APIs.
2. Add the mobile remote command runner.
3. Move the notification listener first, because it is currently failing.
4. Move one-shot Workmux side-channel commands to the runner.
5. Delete or narrow tracked shell-based helper code.
6. Add static guards against direct tmux and `invoke-rc.bash` regressions.
7. Build and install a preview APK.
8. Verify on the mdev remote machine that logs show:
   - clean notification JSONL heartbeats,
   - no malformed prompt/control lines,
   - no stale heartbeat restart loop,
   - no direct tmux/invoke-rc command paths, and
   - actionable update-required errors if old `mdev` is present.

## Risks And Open Questions

- Native command API shape must avoid duplicating shell lifecycle complexity.
- Streaming command cancellation must reliably close remote processes.
- Scrollback batches may expose latency differences when moved from shell
  command execution to exec channels.
- Some remote environments may rely on shell startup files to place `mdev` on
  `PATH`; this design allows a controlled noninteractive login-shell wrapper for
  lookup, but rejects any wrapper that emits prompts, echo, or terminal control
  text.
- Tests need realistic coverage of stderr, exits, timeouts, and stream closure
  so the app does not silently recreate terminal-shell behavior.
