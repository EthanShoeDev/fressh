# Artifact Contract

Read this before setup, then refer back whenever saving round output.

## Source Of Truth

This skill uses one machine source of truth:
- `docs/tool-output/rloop-code-fix/<review-id>/events.jsonl`

It also generates one canonical repo-tracked report:
- `docs/run/rloop-code-fix-<review-id>.md`

Raw transcripts and saved artifacts stay under `docs/tool-output/...`.
Do not hand-edit the tracked report. Record another event and regenerate it.

## Helper Commands

All durable run artifacts go through:
- `.agents/skills/rloop-code-fix/scripts/run-artifacts.mjs`
- `.agents/skills/shared/scripts/subprocess-log-status.mjs` for live external-review polling

Commands:
- `node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs init --review-id <id>`
- `node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record --run-dir <dir> ...`
- `node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs summarize --run-dir <dir>`

`init` creates:
- `docs/tool-output/rloop-code-fix/<review-id>/events.jsonl`
- `docs/run/rloop-code-fix-<review-id>.md`

`record` appends one event and regenerates the tracked report.

`summarize` rereads `events.jsonl` and regenerates the tracked report again. It does not modify the event log.

## Run Layout

- `docs/tool-output/rloop-code-fix/<review-id>/events.jsonl`
- `docs/run/rloop-code-fix-<review-id>.md`
- optional raw artifacts under:
  - `docs/tool-output/rloop-code-fix/<review-id>/rounds/<n>/codex-review.md`
  - `docs/tool-output/rloop-code-fix/<review-id>/deep-review/...`
  - `docs/tool-output/rloop-code-fix/<review-id>/verification/...`

Main-agent triage/fix/verify steps are event-first by default. Do not create raw markdown artifacts for them unless there is meaningful raw output worth preserving.

## Temp File Policy

Keep `/tmp` usage minimal:
- use `/tmp/rloop-review-<review-id>.md` for live `codex review` tee output
- use temporary issue-body files only when actually creating GitHub issues
- do not use `/tmp/rloop-triage-*`, `/tmp/rloop-fix-*`, or `/tmp/rloop-verify-*` by default

For main-agent steps, prefer inline fields plus `--details` / `--details-file`.

## Event Schema

The first event is `run_initialized` and records:
- `version`
- `type`
- `reviewId`
- `runDirRelative`
- `startedAt`
- `timestamp`

Each later event is a `step` and may include:
- `title`
- `phase`
- `round`
- `status`
- `purpose`
- `result`
- `followUp`
- `startedAt`
- `endedAt`
- `durationMs`
- `durationText`
- `command`
- `action`
- `artifactPath`
- `sessionId`
- `verificationStatus`
- `question`
- `answer`
- `details`
- `findings`
- `fixedNow`
- `deferred`
- `separateIssues`
- `falsePositives`
- `notes`
- `timestamp`

Supported phases:
- `setup`
- `external_review`
- `main_agent_triage`
- `main_agent_fix`
- `main_agent_verify`
- `deep_review`
- `user_decision`
- `final_summary`

Supported verification statuses:
- `pass`
- `pass_no_applicable_tests`
- `fail`

## Recording Rules

For every meaningful step:
1. Save a raw artifact only if there is real raw output worth preserving.
2. Append one event that explains what the step did, what it found, and what happens next.
3. Regenerate the tracked report through `record` or `summarize`.

For long-running external review:
1. record `started` when the subprocess begins and you have a live session
2. optionally record `waiting` only when the wait state meaningfully changes
3. record `stalled` when there has been no observable progress for 15 minutes
4. record the terminal result as `clean`, `issues_found`, `failed`, or `blocked`

For user choices:
- record `final_summary` with `status "needs_user_decision"` when the workflow pauses for an answer
- once the user answers, record a `user_decision` step with:
  - `question`
  - `answer`
  - `result`
- if the user stops the loop, record a later `final_summary` with `status "stopped"`

## Workflow Invariants

The report and status logic treat these as hard requirements:
- every `main_agent_fix` must be followed by a same-round `main_agent_verify` before the next external review, deep review, user decision, or final closeout
- only a clean external review can unlock deep review or final closeout
- completed closeout cannot be recorded before the latest clean external review
- deep-review findings must be represented in structured event fields, not only prose

If an invariant is violated, the tracked report must show it under workflow violations, and the run must not report `ready`.

## Path Rules

- `run-dir` must be a direct child of `docs/tool-output/rloop-code-fix/`
- artifact destinations must stay inside the selected run directory
- raw artifact destinations are unique unless they are retry-versioned paths under `verification/` or same-round `main-agent-fix` / `main-agent-verify`
