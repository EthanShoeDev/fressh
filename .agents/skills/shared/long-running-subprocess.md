# Long-Running Subprocess Pattern

Use this when a skill starts a command that may keep running for minutes or hours, such as `codex review`, CI watchers, browser automation, or data backfills.

Goal:
- keep the skill moving automatically while the subprocess is healthy
- keep user-facing updates token-efficient
- involve the user only when there is a real decision to make

## Default Rules

- Start the subprocess once.
- If the tool returns a live session instead of a completed result, keep polling it yourself.
- Do not ask the user to press continue while the subprocess is still making progress.
- Treat no progress for 15 minutes as stalled.
- Keep waiting as long as progress continues, even if total runtime exceeds 1 hour.
- Emit commentary only when the wait state changes.

## Progress Definition

A subprocess is making progress when at least one of these is true:
- new output appears in the live session
- the tee'd log file grows
- the tee'd log file timestamp advances

Liveness alone is not enough. A process that is still running but has produced no new output for 15 minutes is stalled.

## Codex Tool Pattern

In Codex tool environments:
1. start the subprocess with `exec_command`
2. tee output to a scratch log file
3. if the command returns `session_id`, poll with `write_stdin(chars: "")`
4. after each poll, inspect the log with:

```bash
node .agents/skills/shared/scripts/subprocess-log-status.mjs \
  --log "/tmp/<log-file>.md" \
  --tail 40
```

If you already have a previous log snapshot, compare against it:

```bash
node .agents/skills/shared/scripts/subprocess-log-status.mjs \
  --log "/tmp/<log-file>.md" \
  --tail 40 \
  --baseline-size "<previous-size-bytes>" \
  --baseline-updated-at "<previous-updated-at>"
```

Interpret the helper output like this:
- `progressState: "progressed"` -> keep waiting silently or with a short state-change update
- `progressState: "idle"` -> keep polling until the 15-minute stall threshold is reached
- `progressState: "missing"` -> the tee target is missing; investigate before continuing
- `progressState: "unknown"` -> first observation; record it as the starting point

## User Updates

Allowed updates:
- subprocess started
- first real output arrived
- progress resumed after a quiet period
- process completed
- process stalled and now needs a decision

Avoid updates like:
- "I can keep waiting if you want"
- "Press continue to keep polling"
- repeated unchanged heartbeat messages

## Ask The User Only When

- the subprocess has been idle for 15 minutes
- it exits without a usable result or verdict
- it exits with failure and there is a real recovery choice
- the workflow reaches a normal product/scope/triage decision

## Reporting

If the skill keeps durable artifacts, record explicit wait states:
- `started`
- `waiting`
- `stalled`
- `completed` or domain-specific terminal states such as `clean` / `issues_found`
- `failed`
- `blocked`

That way the trace shows that the agent waited automatically and only asked the user when the process stopped progressing or reached a real decision point.
