# mdev Bridge JSONL Design

## Overview

Add a persistent request/response protocol to `mdev`:

```text
mdev bridge --jsonl
```

The bridge reads newline-delimited JSON requests from stdin and writes
newline-delimited JSON responses to stdout. It is a transport wrapper around the
existing `mdev` command router, not a new semantic API. The first consumer is
expected to be Fressh mobile, but this spec only covers the `mdev` side. Mobile
integration gets a separate design after the standalone bridge exists.

## Goals

- Reuse existing `mdev` command behavior through the current argv-based router.
- Avoid one process/SSH exec startup per bounded command.
- Keep the protocol structured, explicit, and easy for mobile clients to probe.
- Keep unsupported, malformed, timed-out, and failed requests as per-request
  errors whenever possible.
- Preserve the current command output contract: clients still parse stdout and
  stderr as they do for normal CLI invocations.

## Non-Goals

- Do not implement Fressh mobile bridge integration in this spec.
- Do not move scrollback off DirectMux in this spec.
- Do not create command-specific typed bridge payloads.
- Do not support streaming, terminal UI, prompt-driven, or long-running commands
  through the bridge in v1.
- Do not support request cancellation in v1.
- Do not execute bridge requests concurrently in v1.

## Protocol

The command is:

```text
mdev bridge --jsonl
```

The bridge does not print a startup banner. Clients send explicit requests. Each
request and response is one JSON object followed by `\n`.

Supported request types:

```json
{"id":"1","type":"hello"}
{"id":"2","type":"command","argv":["tmux","app","nav","next","--session","main"],"timeoutMs":10000}
```

`id` is required for valid client requests and may be a string or number. The
bridge echoes it unchanged in the response. If malformed input has no recoverable
id, the bridge responds with `id:null`.

`hello` response:

```json
{"id":"1","ok":true,"type":"hello","protocolVersion":1,"bridgeVersion":"1","supportedRequestTypes":["hello","command"],"blockedCommandPolicy":"structured-error"}
```

Command success response:

```json
{"id":"2","ok":true,"type":"command","exitCode":0,"stdout":"...","stderr":""}
```

Command failure response:

```json
{"id":"3","ok":false,"type":"command","exitCode":64,"stdout":"","stderr":"Command is not supported by mdev bridge\n","error":"Command is not supported by mdev bridge"}
```

The bridge is transport-only. It does not parse command stdout into a `json`
field and does not return command-specific typed payloads.

## Command Safety

The bridge accepts bridge-safe non-interactive `mdev` commands. A command is
bridge-safe when it:

- completes as a bounded request/response command;
- writes bounded stdout and stderr;
- does not require a terminal UI;
- does not read interactively from stdin;
- can run sequentially without corrupting bridge process state.

Blocked in v1:

- `bridge` itself;
- `tmux attach`;
- `tmux notifications listen`;
- prompt-driven commands such as `tmux workspace close`;
- setup, bootstrap, server, or daemon-style commands that may be long-running or
  interactive;
- unknown or explicitly unclassified commands.

Allowed in v1 should start with commands needed by Fressh mobile and other
clearly bounded command/query surfaces:

- `tmux app context`;
- `tmux app window`;
- `tmux app focus ...`;
- `tmux app nav ...`;
- `tmux app notification open ...`;
- `tmux get status ...`;
- `tmux set status ...`.

The allowlist should live in one bridge command-safety module and be tested
directly. New commands must be reviewed before being added.

## Execution Model

The protocol includes request ids, but v1 executes requests sequentially in input
order. Responses are written after each request completes or fails. Out-of-order
responses and concurrent command execution are reserved for a future protocol
revision.

Each command request may specify `timeoutMs`. The bridge enforces a default
timeout and a maximum timeout. A timed-out request returns `ok:false`,
`exitCode:124`, a timeout message, and the bridge continues reading later
requests.

There is no cancel request in v1. Timeout is the only interruption mechanism.

## mdev Implementation Shape

The `mdev` source is a Bun TypeScript CLI. It already has a clean root
`runCli(argv, io)` dispatch function and command modules such as
`runTmuxCommand`. The bridge should reuse that existing path.

Expected implementation units:

- `src/commands/bridge.ts`: parses `bridge --jsonl` flags and starts the JSONL
  loop.
- `src/lib/bridge/protocol.ts`: request/response types, validation, JSON
  parsing, and JSON serialization.
- `src/lib/bridge/command-safety.ts`: allowlist/blocklist logic for
  bridge-safe argv.
- `src/lib/bridge/runner.ts`: captures stdout/stderr with an in-memory `CliIo`,
  runs the existing command router, applies timeout, and maps thrown errors to
  normal CLI-style exit codes.
- `test/bridge*.test.ts`: protocol, safety, runner, timeout, malformed input,
  and loop tests.

Because the bridge runner needs to call the same root dispatcher as `src/cli.ts`,
the root dispatch function should be moved to a small reusable module, for
example `src/lib/run-cli.ts`. Then `src/cli.ts` and the bridge runner both call
that module. This avoids an import cycle between the bridge command and the CLI
entrypoint.

## Data Flow

```text
client
  -> stdin JSONL request
  -> mdev bridge protocol parser
  -> command safety check
  -> in-memory CliIo
  -> existing mdev runCli(argv, io)
  -> captured stdout/stderr/exitCode
  -> stdout JSONL response
```

Per-request command stderr is captured into the JSON response. Bridge process
stderr is reserved for bridge diagnostics and broken-pipe style process-level
failures.

## Error Handling

- Malformed JSON: return a structured protocol error and keep the bridge alive.
- Missing or invalid `id`, `type`, `argv`, or `timeoutMs`: return a structured
  protocol error and keep the bridge alive.
- Unsupported command: return `ok:false`, `exitCode:64`, and keep the bridge
  alive.
- Existing `CliError`: mirror normal CLI behavior by returning its exit code and
  captured stderr.
- Unknown thrown error: return `ok:false`, `exitCode:1`, and include the message
  in `stderr` and `error`.
- Timeout: return `ok:false`, `exitCode:124`, and keep the bridge alive.
- stdout write failure for the JSONL response: treat as a bridge transport
  failure; the process may exit non-zero because the client pipe is broken.

Invalid input should be a request-level protocol failure whenever possible, not a
reason to terminate the bridge.

## UX Impact

No direct Fressh UX changes are included in this spec. The expected downstream
effect is faster and cleaner generic Workmux actions once Fressh mobile uses the
bridge instead of one-shot `mdev` execution.

## Data Impact

No persisted data, schema, or migration changes are required.

## Code Impact

The change is confined to the `mdev` CLI. It adds a new bridge command and a
small protocol/runner layer around the existing router. Command semantics remain
owned by existing command modules. The bridge centralizes persistent transport
behavior without duplicating `tmux app` logic.

The main regression surface is command dispatch parity, error formatting, bridge
process lifetime, timeout handling, and the command safety allowlist.

## Verification

- Unit tests cover protocol validation and response serialization.
- Unit tests cover command safety allow/block decisions.
- Runner tests prove successful and failing safe commands return the same
  stdout, stderr, and exit code as direct `runCli` invocation.
- Loop tests cover `hello`, command success, unsupported commands, malformed
  JSON, malformed request objects, timeout responses, and bridge survival after
  per-request failures.
- Sequential ordering tests prove v1 runs requests in input order.
- Manual smoke test:
  - start `mdev bridge --jsonl`;
  - send `hello`;
  - send `tmux app context --session main`;
  - send blocked `tmux notifications listen --session main`;
  - verify the blocked command returns a structured error and the bridge still
    answers another `hello`.

## Open Follow-Up

After this standalone `mdev` bridge lands, write a separate Fressh mobile design
to make `WorkmuxControlChannel.command(argv)` prefer the persistent bridge and
fall back to one-shot `mdev` execution when the bridge is unavailable or too old.
