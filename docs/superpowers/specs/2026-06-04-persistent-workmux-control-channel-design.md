# Persistent Workmux Control Channel Design

## Overview

Fressh mobile needs a low-latency Workmux control path. The current
noninteractive command transport is acceptable for discrete commands, but it is
too slow for finger-coupled scrollback. The measured restored path averages
about 138 ms per serialized scroll command, which causes visible jump/catch-up
behavior during slow drags.

The design is to introduce a `WorkmuxControlChannel` abstraction that gives the
app one control surface for Workmux actions. The channel can use the fastest
correct transport internally: a future persistent `mdev` bridge for generic
commands, direct persistent tmux control for scroll while the bridge does not
have an optimized scroll path, and one-shot remote command execution only as a
fallback.

## Goals

- Restore solid, finger-synchronized Android scrollback UX.
- Centralize Workmux command transport decisions in one module.
- Reuse existing `mdev` command code where possible through a generic command
  API.
- Keep direct tmux knowledge out of UI call sites.
- Allow a future persistent `mdev` bridge to replace direct tmux internals
  without changing the mobile UI surface.

## Non-Goals

- Do not rewrite all `mdev` command logic in mobile.
- Do not block the scroll UX fix on a complete `mdev` bridge implementation.
- Do not route high-frequency scroll through one SSH exec per gesture batch.
- Do not scatter direct tmux command strings across the app.

## Architecture

Add a `WorkmuxControlChannel` per active SSH connection/session:

```ts
type WorkmuxControlChannel = {
	command(
		argv: string[],
		options?: WorkmuxControlCommandOptions,
	): Promise<WorkmuxControlCommandResult>;
	scroll: {
		enter(input: WorkmuxScrollTarget): Promise<void>;
		move(input: WorkmuxScrollMove): Promise<void>;
		exit(input: WorkmuxScrollTarget): Promise<void>;
	};
	dispose(): Promise<void>;
};
```

Generic actions call `command(argv)`:

```ts
channel.command(['tmux', 'app', 'nav', 'next']);
channel.command(['tmux', 'app', 'focus', 'codex']);
channel.command(['tmux', 'app', 'context', '--session', 'main']);
```

The preferred long-term generic transport is a persistent `mdev` bridge, for
example:

```text
mobile hidden shell -> mdev bridge --jsonl -> existing mdev command router
```

Messages are JSONL request/response records:

```json
{"id":"1","argv":["tmux","app","nav","next"]}
{"id":"1","ok":true,"stdout":"","stderr":"","exitCode":0}
```

Scroll uses the channel's `scroll` sub-API instead of generic command execution.
The first implementation uses persistent direct tmux control internally for
scroll because scroll is high-frequency and latency-sensitive. The app still
talks to the channel abstraction, not directly to tmux.

## Command Ownership

Use the control channel for:

- Scrollback enter, move, and exit.
- Keyboard Workmux navigation: `next`, `prev`, `next-all`, `prev-all`,
  `select`.
- Keyboard Workmux focus: `claude`, `codex`, `git`, `bash`, and
  `toggle-git-bash`.
- Notification select-window when the target window id is already known.

Prefer `mdev` semantics through `command(argv)` for:

- Current context and path queries.
- Current window metadata.
- Browser/GitHub/open actions.
- Commands that need structured JSON or Workmux routing decisions.

The split is pragmatic: latency-sensitive interactive actions should use the
fastest persistent implementation, while semantic actions should lean on
existing `mdev` logic.

## Data Flow

Generic command flow:

```text
UI/controller
  -> WorkmuxControlChannel.command(argv)
  -> persistent mdev bridge when available
  -> existing mdev command router
  -> typed result or formatted failure
```

Temporary generic fallback:

```text
UI/controller
  -> WorkmuxControlChannel.command(argv)
  -> current one-shot runCommand mdev execution
  -> typed result or formatted failure
```

Scroll flow:

```text
xterm touch controller
  -> scroll accumulator
  -> WorkmuxControlChannel.scroll.move(...)
  -> persistent fast scroll transport
  -> terminal updates with minimal command latency
```

## Error Handling

- If the persistent bridge is unavailable, generic commands fall back to the
  current one-shot `mdev` command path.
- If `mdev` is missing or too old, generic command failures use the existing
  "Update mdev..." copy.
- If the fast scroll transport is unavailable, the app exits local scrollback
  UI state, restarts the channel on the next gesture, and only shows an error
  when recovery fails.
- If a hidden channel fails, it must not corrupt the visible terminal shell.
- Target/session changes invalidate and recreate the active channel.
- Scroll "not in mode" failures are treated as state desynchronization: clear
  local scrollback state and recover, not as a modal-worthy user error.

## Rollout

1. Add `WorkmuxControlChannel` and route scroll through it.
2. Back scroll with persistent direct tmux control to fix the UX regression
   immediately.
3. Route Workmux nav/focus/select-window keyboard actions through the channel.
4. Add `mdev bridge --jsonl` and move generic `command(argv)` calls onto it.
5. Keep one-shot `runCommand` as fallback and diagnostics, not as the primary
   transport for interactive Workmux actions.

## UX Impact

Scrollback should again feel synchronized with finger movement during slow
drags. Keyboard Workmux navigation and focus actions should feel more immediate
once they move through the persistent channel. Error dialogs should become less
common for transient scroll state issues; those cases should recover by exiting
local scrollback state and recreating the channel.

## Database/Data Impact

No database or persisted schema change is required. The channel may keep
in-memory state for the active connection, session target, request ids, pending
bridge calls, and scroll transport lifecycle.

## Code Impact

New behavior lives in a Workmux control-channel layer, grouped by transport
responsibility rather than UI screen. UI handlers call channel methods instead
of choosing between side-channel, one-shot command execution, and direct tmux.

Expected code areas:

- Mobile shell detail: inject and use the channel for scroll and Workmux
  keyboard actions.
- Workmux command utilities: expose argv-oriented command helpers where useful.
- Scrollback executor: route through channel scroll methods and keep tracing.
- Optional mdev repository: add `mdev bridge --jsonl` that reuses existing
  command routers.

The change centralizes command routing, removes duplicated transport decisions,
and creates a stable place to swap implementations. The likely regression
surface is scroll lifecycle recovery, keyboard Workmux nav/focus behavior, and
hidden channel cleanup on connection/session changes.

## Contract/API Impact

The mobile-side contract is the `WorkmuxControlChannel` API. The future
remote-side contract is `mdev bridge --jsonl` with request ids, argv arrays,
stdout, stderr, exit code, and explicit success/error status. Scroll may use a
separate optimized message shape on the same bridge once implemented.

## Verification

- Unit tests cover channel routing decisions and fallback behavior.
- Integration tests cover scroll batching, channel invalidation, and "not in
  mode" recovery.
- ADB scroll trace benchmark verifies:
  - accepted batches are greater than zero;
  - dropped batches are zero;
  - failed command count is zero;
  - command latency is dramatically lower than the current roughly 138 ms
    average restored path.
- Manual device verification covers slow drag synchronization, no "not in mode"
  dialog, immediate nav/focus keys, and visible terminal survival after hidden
  channel restart.
