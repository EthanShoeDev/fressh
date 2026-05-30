# Supported Trace Shapes

## Inputs

The improver supports two trace sources in v1:

1. Stored Codex session JSONL files from `~/.codex/sessions/**/*.jsonl`
2. Saved `codex exec --json` output files

## Stored Session JSONL

Expected top-level event families:

- `session_meta`
- `response_item`
- `event_msg`
- `turn_context`

Important response payload types:

- `message`
- `reasoning`
- `function_call`
- `function_call_output`
- `custom_tool_call`
- `custom_tool_call_output`

Token usage can also appear in:

- `event_msg` with `payload.type == "token_count"`
- `payload.info.total_token_usage` for cumulative usage
- `payload.info.last_token_usage` for the latest step
- `payload.info.model_context_window` when present

The normalizer should pair `function_call` and `function_call_output` by `call_id`, then classify `exec_command` calls as shell commands when possible.

The normalized output should still expose a synthetic turn structure so later stages can build:

- `transcript.md`
- `normalized-trace.json`
- `evidence.json`

## codex exec --json

The exec JSONL contract is more event-oriented. The improver should tolerate variations in wrappers and look for:

- event types such as `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `error`
- item payloads that expose `command_execution`, `message`, or `reasoning`
- usage information on completed turns when present
- aggregate usage across multiple completed turns instead of keeping only the last observed usage

Treat unknown event shapes as best-effort input instead of failing unless the file cannot be parsed as JSONL.

The normalizer should group events into turns when `turn.started` / `turn.completed` exist. If they do not, it should create one synthetic turn instead of dropping the trace on the floor.

## Explicitly Unsupported

- Legacy rollout `.json` logs
- Binary or non-JSONL traces
- Mixed trace directories passed as a single file

Reject unsupported inputs with a direct message that tells the caller to provide a session `.jsonl` file or a saved `codex exec --json` trace.

## Token Accounting Caveat

Token accounting is best-effort only:

- some logs expose full cumulative token counts
- some logs expose only per-turn usage
- some logs expose no token usage fields at all

When token accounting is missing, the improver should report `token_usage_unavailable` instead of estimating or inventing totals.
