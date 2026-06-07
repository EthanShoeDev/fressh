# Fressh mdev Bridge Mobile Integration Design

## Overview

Fressh mobile should use the `mdev bridge --jsonl` protocol from
`mulyoved/skills` PR #121 for generic Workmux commands. The bridge protocol is
typed-operation based, not raw argv based:

```json
{"id":"1","type":"operation","operation":"tmux.app.nav","params":{"action":"next","session":"main"},"timeoutMs":10000}
```

This spec covers the Fressh mobile integration only. It assumes the remote
machine has an `mdev` build with the bridge protocol from PR #121 or a compatible
successor.

The integration keeps DirectMux for scrollback. Scroll remains the special
latency-critical path. Generic Workmux commands move to the persistent `mdev`
bridge and do not fall back to one-shot `mdev` execution.

## Goals

- Route generic Workmux actions through a persistent `mdev bridge --jsonl`
  process.
- Fail fast and noisily when the bridge is missing, too old, unsupported, or
  unavailable.
- Remove one-shot `mdev` fallback from the normal Workmux command path.
- Preserve the current mobile call surface where practical:
  `WorkmuxControlChannel.command(argv, options)`.
- Translate known Workmux argv shapes into PR #121 bridge operations.
- Keep DirectMux-backed scroll enter, move, and exit unchanged.
- Make bridge startup, capability checks, request/response parsing, disposal,
  and errors testable without a device.

## Non-Goals

- Do not migrate scrollback to the `mdev` bridge.
- Do not keep one-shot `mdev` fallback for bridge-backed Workmux commands.
- Do not support arbitrary argv through the bridge.
- Do not parse command stdout to recover typed data.
- Do not add bridge request concurrency in the mobile client.
- Do not change the keyboard layout or key labels.

## Required Remote Contract

The remote `mdev` must support:

```text
mdev bridge --jsonl
```

The bridge must accept:

```json
{"id":"hello-1","type":"hello"}
```

and return:

```json
{
  "id":"hello-1",
  "ok":true,
  "type":"hello",
  "protocolVersion":1,
  "bridgeVersion":"1",
  "supportedRequestTypes":["hello","operation"],
  "operations":["tmux.app.context"]
}
```

The mobile client requires `protocolVersion: 1`, request type `operation`, and
the operation ids used by the current mobile feature path. Missing requirements
are startup failures, not runtime fallbacks.

## Mobile Command Mapping

Mobile keeps using argv builders as the local intent format. A new mapper
converts known argv shapes into bridge operation requests.

Supported mappings:

| Mobile argv | Bridge operation | Params |
| --- | --- | --- |
| `["tmux","app","context","--session",session]` | `tmux.app.context` | `{ "session": session }` |
| `["tmux","app","window","--session",session]` | `tmux.app.window` | `{ "session": session }` |
| `["tmux","app","notification","open","--session",session,"--window-id",id]` | `tmux.app.notification.open` | `{ "session": session, "windowId": id }` |
| `["tmux","app","focus",target,"--session",session]` | `tmux.app.focus` | `{ "roleOrDirection": target, "session": session }` |
| `["tmux","app","nav","next","--session",session]` | `tmux.app.nav` | `{ "action": "next", "session": session }` |
| `["tmux","app","nav","prev","--session",session]` | `tmux.app.nav` | `{ "action": "prev", "session": session }` |
| `["tmux","app","nav","next-all","--session",session]` | `tmux.app.nav` | `{ "action": "next-all", "session": session }` |
| `["tmux","app","nav","prev-all","--session",session]` | `tmux.app.nav` | `{ "action": "prev-all", "session": session }` |
| `["tmux","app","nav","select",index,"--session",session]` | `tmux.app.nav` | `{ "action": "select", "index": Number(index), "session": session }` |
| `["tmux","nav","cycle",target]` | `tmux.nav` | `{ "action": "cycle", "target": target }` |

The mapper rejects unknown argv shapes locally with a clear unsupported-command
error. It must not call one-shot `mdev` as a fallback. This is deliberate: an
unexpected command shape means the mobile integration and bridge contract are out
of sync.

Scroll argv builders may remain for legacy tests and command formatting, but the
scroll executor continues to call `WorkmuxControlChannel.scroll.*`, which uses
DirectMux.

## Bridge Transport

Add a mobile-side bridge transport owned by the Workmux control-channel layer.
It starts one remote bridge process for the active SSH connection:

```text
mdev bridge --jsonl
```

The transport must provide bidirectional JSONL:

- write one request line to bridge stdin;
- read one response line from bridge stdout;
- treat bridge stderr as diagnostics;
- close the remote stream on disposal.

The implementation plan must verify whether the existing
`startCommandStream(...)` API supports stdin writes. If it does, reuse it. If it
does not, add the smallest native/API support needed for bidirectional command
streams. Do not use an interactive tmux shell or `invoke-rc.bash` for this
bridge.

The bridge client runs requests sequentially in v1. It should queue commands in
input order and require one response per request id before sending or resolving
the next command. This matches PR #121's sequential bridge behavior and avoids
tmux state races.

## Startup And Capabilities

The bridge transport starts lazily on the first generic Workmux command for an
active connection. Startup sequence:

1. Start `mdev bridge --jsonl`.
2. Send `hello`.
3. Validate protocol version and supported request types.
4. Validate required operations for the current command path.
5. Mark the bridge ready.

Required operations:

- `tmux.app.context`
- `tmux.app.window`
- `tmux.app.focus`
- `tmux.app.nav`
- `tmux.app.notification.open`
- `tmux.nav`

The required list intentionally excludes scroll operations because mobile keeps
DirectMux for scroll.

If startup or capability validation fails, the command fails with an update
message such as:

```text
Update mdev on the remote machine; this action requires mdev bridge --jsonl.
```

The bridge should be disposed when the active connection changes or the
Workmux control channel is disposed.

## Error Handling

Generic Workmux command failures are visible failures:

- bridge command missing or exits early: update mdev / bridge unavailable error;
- malformed bridge response: bridge protocol error;
- missing required operation: update mdev / bridge capability error;
- operation response `ok:false`: surface the bridge error message;
- request timeout: bridge request timed out;
- stream closes while requests are pending: fail pending and future commands for
  that channel.

There is no one-shot `mdev` fallback. A failed bridge means the feature is not
available until the remote `mdev` is updated or the connection is recreated with
a working bridge.

Scroll errors remain DirectMux scroll errors and are handled by the existing
scrollback recovery path.

## UX Impact

No keyboard layout or label changes are intended.

Keyboard Workmux navigation, focus, and status-cycle actions should feel more
immediate after the bridge is running because they avoid one remote process per
command. If the remote is missing the bridge, users should get a clear update
message instead of a silent fallback or slow degraded behavior.

Scroll UX should not regress because scroll remains on DirectMux.

## Data Impact

No persisted data, schema, migration, or backup change is required.

The bridge keeps in-memory state only: stream handle, request id counter,
readiness/capability result, pending request, and disposed/failed state.

## Code Impact

Expected mobile areas:

- `apps/mobile/src/lib/workmux-control-channel.ts`
  - replace one-shot `runRemoteCommand(formatMdevArgvCommand(argv))` with a
    bridge-backed command path;
  - keep DirectMux scroll methods unchanged.
- New bridge client module, for example
  `apps/mobile/src/lib/mdev-bridge-client.ts`
  - owns JSONL protocol types, request queue, startup hello, capability checks,
    response validation, stream disposal, and failure state.
- New argv mapper module, for example
  `apps/mobile/src/lib/workmux-bridge-operations.ts`
  - maps known Workmux argv arrays to bridge operation id and params.
- Shell detail wiring
  - pass the connection/stream capability needed by the bridge client into
    `createWorkmuxControlChannel`;
  - remove generic one-shot fallback from Workmux command execution.
- Tests
  - cover argv-to-operation mapping, bridge startup, capability failures,
    request/response success, operation errors, stream closure, timeout, and
    DirectMux scroll preservation.

The rule lives in the control-channel layer: UI and keyboard code still express
intent through existing Workmux command helpers, while transport selection is
owned below them. Logic is centralized rather than duplicated at call sites.

The main regression surface is keyboard Workmux actions, notification routing,
host/browser context lookups that depend on `tmux.app.context`, bridge lifecycle
cleanup, and preserving DirectMux scroll behavior.

## Verification

- Unit/integration tests for `workmux-bridge-operations` mapping:
  - all supported argv shapes map to the expected operation and params;
  - malformed or unknown argv fails locally;
  - nav select index is numeric and safe.
- Unit/integration tests for the bridge client:
  - sends `hello` before the first operation;
  - rejects missing protocol support;
  - rejects missing required operations;
  - resolves successful operation responses;
  - rejects `ok:false` responses;
  - fails pending requests when the stream closes;
  - does not call one-shot `mdev` on bridge failure.
- Existing Workmux keyboard tests updated to assert bridge operation calls rather
  than one-shot command strings where the channel is available.
- Existing scrollback tests continue to assert DirectMux scroll routing.
- Manual device verification:
  - install/update a bridge-capable `mdev` on the remote;
  - connect from the mobile app;
  - use keyboard nav/focus/status-cycle keys;
  - trigger notification open and context/window flows;
  - verify no one-shot `mdev` commands are used for those actions;
  - verify scroll remains smooth and DirectMux-backed;
  - temporarily use an old `mdev` and verify the app fails with the update
    message.

## Open Follow-Up

After this integration lands, measure whether generic command latency improves
enough to justify moving any additional bounded commands onto the bridge. Do not
revisit scroll transport unless bridge latency is proven to match or beat the
current DirectMux scroll path.
