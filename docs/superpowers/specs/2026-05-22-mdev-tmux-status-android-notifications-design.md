# Mdev Tmux Status Android Notifications Design

## Context

Issue 55 requests an Android notification when a Claude/Codex-style agent
finishes and awaits input. In the current workflow, that state is already
represented in tmux with `@workmux_status` icons:

- `💬` for waiting/needs input
- `✅` for done/ready for attention
- `🤖` for working
- `💤` and `🕒` for manual hidden/parked states

Fressh is a React Native Android app connected to the remote host over SSH. The
event happens on the remote host, but the notification must be posted by Android
on the phone. Fressh already has an Android foreground service to keep SSH
sessions alive in the background, so this design uses that foreground-service
lifecycle as the notification bridge. It does not introduce cloud push.

This is a best-effort connected-mode design. It optimizes for immediate
notifications while Fressh's Android foreground service and SSH connection are
alive. It does not guarantee notification delivery after Android stops the
service, suspends background network work, kills the app process, or enforces
foreground-service time limits on long background sessions.

## Goals

- Notify on remote status transitions to waiting (`💬`) or done (`✅`).
- Deliver Android local notifications while the app is backgrounded or open.
- Use a long-lived listener over the existing active SSH connection.
- Keep the remote event source deterministic by emitting events only from
  `mdev tmux set status`.
- Deduplicate notifications per tmux window until the matching window is viewed
  in Fressh.
- Keep the notification bridge observable with health state, heartbeats, stale
  detection, and reconnect-on-resume behavior.

## Non-Goals

- Do not detect manual `tmux set-option @workmux_status ...` writes.
- Do not poll tmux status periodically.
- Do not add a cloud push broker, FCM route, account identity, or server-side
  delivery path.
- Do not support notification delivery after the Fressh foreground service or
  SSH connection is gone.
- Do not make `working` or `clear` status changes create Android notifications.
- Do not promise reliable hours-later idle delivery. If that becomes a hard
  requirement, use an OS-supported push path such as FCM or another wake-capable
  delivery mechanism.

## GitHub Tracking

- M-Dev remote event stream:
  [mulyoved/skills#39](https://github.com/mulyoved/skills/issues/39)
- Fressh Android notification bridge:
  [mulyoved/fressh#56](https://github.com/mulyoved/fressh/issues/56)
- Parent request:
  [mulyoved/fressh#55](https://github.com/mulyoved/fressh/issues/55)

## Architecture

Remote `mdev` is the notification-producing boundary. When an agent wrapper or
tool calls:

```sh
mdev tmux set status waiting [target]
mdev tmux set status done [target]
```

`mdev` updates the target window's `@workmux_status` and appends a durable
JSON-line notification event to a small per-user spool. It appends an event only
when the local window status actually changes to `💬` or `✅`.

Fressh starts one listener command for the active tmux-enabled Android
foreground-service connection:

```sh
mdev tmux notifications listen --session main
```

The command blocks and streams newline-delimited JSON events. The React Native
side parses those events, deduplicates them per remote/session/window, and calls
a native Android notification module to post local alert notifications.

Acknowledgement is app-side. When Fressh opens or selects the matching tmux
window, it clears the pending dedupe key for that remote/session/window and
dismisses the notification if it is still visible.

## Power Management Position

The long-lived SSH listener remains the v1 transport because it is simple,
private, and matches the existing Fressh model where a foreground service keeps
the terminal connection alive. Fressh should continue using aggressive
continuity for connected shells: the foreground service stays active and the
existing partial wake lock remains held while the service is running.

That wake lock and foreground service improve continuity but are not a full
exemption from Android power policy. Android can delay background network during
Doze/App Standby, kill the app or service under pressure, and impose
foreground-service limits on long background work. Therefore the product
promise is:

> Fressh can notify from remote `mdev` events while its Android foreground SSH
> service and connection remain alive. If Android stops the service or network,
> delivery resumes only after reconnect/listener restart.

The future path for reliable hours-later idle delivery is push-style delivery,
such as FCM, with explicit device identity, remote publishing, and server-side
auth. That is outside this v1 design.

## M-Dev Workstream

The M-Dev workstream belongs in the `mulyoved/skills` repository, under the
`dev-env/mdev` package. It owns the remote event source, event persistence, and
listener CLI.

### M-Dev Scope

M-Dev should:

- Extend `mdev tmux set status waiting|done [target]` so it appends a
  notification event after a real status change.
- Keep `working` and `clear` status behavior unchanged and non-notifying.
- Resolve stable tmux window metadata for each event.
- Persist events to a bounded per-user JSONL spool.
- Expose `mdev tmux notifications listen --session <name>` as a blocking
  JSONL stream of future events.
- Emit lightweight heartbeat lines while the listener is running.
- Support `--since-id <id>` so Fressh can resume after listener restarts.
- Keep status writes resilient if notification event persistence fails.

M-Dev should not:

- Detect manual `tmux set-option @workmux_status ...` writes.
- Know about Android notification channels, app foreground state, or Fressh
  dedupe state.
- Implement cloud push, account identity, or device registration.

### M-Dev Contract

`mdev tmux set status waiting|done [target]` should:

1. Resolve the target tmux window and metadata.
2. Read the local `@workmux_status` for that target.
3. If the status is already the requested icon, skip the tmux write and skip
   event creation.
4. Otherwise write the new status.
5. Append a JSONL event for `waiting` or `done`.

`mdev tmux set status working|clear [target]` should preserve existing status
behavior but should not append notification events.

The event shape should be stable JSON:

```json
{
  "id": "main:@12:1779434000000:waiting",
  "type": "tmux_status",
  "session": "main",
  "target": "main:4",
  "windowId": "@12",
  "windowIndex": "4",
  "windowName": "fressh",
  "status": "waiting",
  "icon": "💬",
  "createdAtMs": 1779434000000
}
```

Required fields:

- `id`: stable event id suitable for cursoring and duplicate suppression
- `type`: `tmux_status`
- `session`: tmux session name
- `target`: human-readable tmux target used for selection
- `windowId`: stable tmux window id when available
- `windowIndex`: current tmux window index
- `windowName`: current tmux window name
- `status`: `waiting` or `done`
- `icon`: `💬` or `✅`
- `createdAtMs`: event creation time in epoch milliseconds

`mdev tmux notifications listen --session <name>` should follow new events for
that session. By default, it starts at the current end of the spool so opening
Fressh does not replay stale attention events as fresh Android notifications.

The listener must emit heartbeat JSONL lines every 60 seconds so Fressh can
distinguish an idle stream from a dead stream:

```json
{
  "type": "heartbeat",
  "session": "main",
  "createdAtMs": 1779434060000
}
```

The listener must support `--since-id <id>`. When supplied, it replays events
after that id and then follows new events. Fressh keeps the last seen event id
in memory while the foreground-service connection is alive and passes it when
restarting the listener after an unexpected listener exit.

The spool can be a compact JSONL file under the user's runtime/config state. It
must retain at most the last 5,000 events and no events older than 24 hours so
long-running environments do not grow without limit.

The listener must not use a busy loop. It should block efficiently on the
remote host using filesystem watch support or a blocking tail-like strategy
where available. If it must poll as a fallback, it should use a low-frequency
sleep interval of at least 1 second and document that as a fallback behavior.

### M-Dev Tests

Remote `mdev` tests:

- `mdev tmux set status waiting` writes `💬` and appends exactly one event.
- Repeating `waiting` for the same target does not append a duplicate event.
- `done` appends a new event after `waiting`.
- `working` and `clear` do not append notification events.
- `notifications listen` emits valid JSONL for followed events.
- `notifications listen` emits heartbeat JSONL lines while idle.
- `notifications listen --since-id <id>` replays events after that id and then
  follows new events.
- Listener follow mode does not busy-poll the event spool.
- Event metadata includes session, target, window id/index/name, status, icon,
  and timestamp.
- Event spool retention keeps storage bounded.

## Fressh Workstream

The Fressh workstream belongs in the `mulyoved/fressh` repository. It owns the
Android notification bridge, SSH listener lifecycle, app-side parsing, dedupe,
and acknowledgement behavior.

### Fressh Scope

Fressh should:

- Start a long-lived listener command over the active SSH connection while the
  Android foreground service is keeping a tmux-enabled shell alive.
- Parse newline-delimited `mdev` notification events.
- Post Android local notifications for `waiting` and `done` events.
- Deduplicate pending alerts per `connectionId | session | windowId`.
- Clear pending state when the matching tmux window is visible or selected.
- Restart the listener with capped backoff after unexpected exits.
- Track notification bridge health separately from SSH shell health.
- Detect stale heartbeats and restart the listener while the SSH connection
  still exists.
- Keep the interactive terminal session working even if notification listening
  fails.

Fressh should not:

- Poll tmux status.
- Detect manual remote tmux status writes.
- Deliver notifications after the foreground service or SSH connection is gone.
- Implement cloud push or any server-side delivery mechanism.

### Fressh Behavior

Notification listening follows the Android foreground-service connection
lifecycle:

- Start the listener when Android has an active tmux-enabled SSH connection and
  the foreground service should keep that connection alive.
- Stop the listener when the connection closes, the shell is removed, or the
  foreground service stops.
- Restart the listener with capped backoff if it exits unexpectedly while the
  SSH connection is still alive, passing the in-memory last seen event id when
  available.
- Restart the listener with capped backoff if heartbeats become stale while the
  SSH connection is still alive.
- Re-check bridge state on app resume. If the SSH connection survived, restart
  the listener with `--since-id <lastSeenId>` when available.
- Log listener failures without disrupting the interactive shell.

Fressh tracks the notification bridge as a health state:

- `inactive`: no tmux-enabled foreground-service connection
- `starting`: listener command is being opened
- `active`: listener is connected and receiving heartbeats/events
- `degraded`: listener exited or heartbeat is stale, reconnect scheduled
- `stopped-by-os-or-connection`: SSH/service is gone, no notification delivery
  expected

The foreground service notification may include bridge state text such as
`Agent alerts active` or `Agent alerts reconnecting`. Bridge failures should not
create noisy alert notifications; they should be logged and reflected in
non-intrusive connection/health UI.

Notifications should use a separate Android notification channel from the
ongoing SSH foreground-service notification:

- Foreground service: existing low-importance ongoing notification.
- Agent alerts: a new default-importance channel named `Fressh Agent Alerts`
  with channel id `fressh_agent_alerts`.

Fressh deduplicates pending alerts by:

```text
connectionId | session | windowId
```

If `windowId` is unavailable, Fressh may fall back to `connectionId | session |
windowIndex`, accepting that tmux window renumbering can make that less stable.

When an event arrives for a pending key, Fressh skips posting another
notification. When the matching tmux window becomes visible or selected in
Fressh, Fressh clears the pending key and cancels the corresponding
notification.

Tapping a notification should open Fressh to the shell. If selecting the target
tmux window is safe through `mdev`, tapping may also select the target window.
For the first implementation, it is acceptable for tapping to open the shell and
let acknowledgement occur only when the app observes the matching window as
visible.

### Fressh Tests

Fressh tests:

- JSONL parser accepts valid notification events.
- JSONL parser accepts heartbeat events.
- JSONL parser rejects malformed lines without stopping the listener.
- Dedupe suppresses repeated events for the same
  `connectionId | session | windowId`.
- Viewing/selecting the matching window clears pending dedupe state.
- Listener lifecycle follows foreground-service and SSH connection lifecycle.
- Unexpected listener exit triggers capped restart while connected.
- Stale heartbeat detection moves the bridge to `degraded` and restarts the
  listener while connected.
- App resume re-checks bridge health and restarts the listener when the SSH
  connection survived.
- Native Android agent notifications can post and cancel without affecting the
  ongoing SSH foreground notification.

## Cross-Workstream Error Handling

If `mdev tmux notifications listen` is missing or exits with a command error,
Fressh logs the failure and retries with capped backoff while the SSH connection
remains alive. The terminal session must continue to work.

Malformed listener lines are ignored and logged. One bad JSON line must not kill
the listener loop.

Remote spool write failures should not prevent `mdev tmux set status` from
updating tmux. `mdev` should report the spool failure to stderr and return a
non-zero exit only if the existing status command would normally fail for that
class of error. The notification path should not make agent status updates
fragile.

## Cross-Workstream Manual Verification

1. Build/install an Android preview build.
2. Connect to a tmux-enabled remote session.
3. Background Fressh.
4. On the remote, run `mdev tmux set status waiting <target>`.
5. Confirm Android posts an agent alert notification.
6. Open Fressh and view/select the matching tmux window.
7. Trigger another `waiting` or `done` transition and confirm it notifies again.
8. Kill the remote listener command and confirm Fressh marks the bridge
   degraded, restarts it, and resumes delivery without breaking the shell.
9. Leave Fressh backgrounded long enough to verify the bridge remains active on
   the target device when Android permits the foreground service to continue.
10. Resume Fressh after a long background interval and confirm the bridge health
    is rechecked and the listener restarts if needed.

## Rollout Notes

Agent wrappers should route attention-worthy state changes through
`mdev tmux set status waiting|done`. Any direct `tmux set-option` usage will not
produce phone notifications by design.

This feature depends on the Android foreground service and active SSH
connection. If Android kills the service or the SSH connection drops, remote
events are not delivered until Fressh reconnects and restarts the listener.

Implementation and release notes should describe this as best-effort connected
delivery. If users need reliable notification delivery after hours of phone
idle, after the app process is killed, or after the foreground service is
stopped, the design must move to push/FCM or another OS-supported wake path.
