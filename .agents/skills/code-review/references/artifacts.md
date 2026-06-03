# Artifact Contract

Read this before setup, then refer back whenever saving round output.

## Contents

- Source Of Truth
- Helper Commands
- Run Layout
- Temp File Policy
- Event Schema
- Recording Rules
- Workflow Invariants
- Path Rules

## Source Of Truth

This skill uses one machine source of truth:
- `docs/tool-output/code-review/<review-id>/events.jsonl`

It also generates one canonical repo-tracked report:
- `docs/run/code-review-<review-id>.md`

Raw transcripts and saved artifacts stay under `docs/tool-output/...`.
Do not hand-edit the tracked report. Record another event and regenerate it.

## Helper Commands

All durable run artifacts go through:
- `.agents/skills/code-review/scripts/run-artifacts.mjs`
- `.agents/skills/code-review/shared/scripts/managed-review-process.mjs` for detached external-review start/wait control
- `.agents/skills/code-review/shared/scripts/subprocess-log-status.mjs` for low-level log inspection when needed

Commands:
- `node .agents/skills/code-review/scripts/run-artifacts.mjs init --review-id <id>`
- `node .agents/skills/code-review/scripts/run-artifacts.mjs record --run-dir <dir> ...`
- `node .agents/skills/code-review/scripts/run-artifacts.mjs summarize --run-dir <dir>`
- `node .agents/skills/code-review/scripts/run-boundary-step.mjs --action wait --run-dir <dir> [--poll-ms <ms>] [--timeout-ms <ms>]`

The `wait` helper blocks on durable run state until the detached outer review reaches a terminal event or the timeout expires. If it times out, keep the invocation in commentary or hand off explicitly as a timeout. Do not emit final closeout until a later `wait` call or resumed outer review yields a terminal state.

`init` creates:
- `docs/tool-output/code-review/<review-id>/events.jsonl`
- `docs/run/code-review-<review-id>.md`

`record` appends one event and regenerates the tracked report.

`summarize` rereads `events.jsonl` and regenerates the tracked report again. It does not modify the event log.

## Run Layout

- `docs/tool-output/code-review/<review-id>/events.jsonl`
- `docs/run/code-review-<review-id>.md`
- optional raw artifacts under:
  - canonical clean/issues artifact:
    - `docs/tool-output/code-review/<review-id>/rounds/<n>/codex-review.md`
  - historical blocked/stalled retry artifacts:
    - `docs/tool-output/code-review/<review-id>/rounds/<n>/codex-review-blocked*.md`
    - `docs/tool-output/code-review/<review-id>/rounds/<n>/codex-review-stalled*.md`
  - `docs/tool-output/code-review/<review-id>/deep-review/...`
  - `docs/tool-output/code-review/<review-id>/verification/...`

Main-agent triage/fix/verify steps are event-first by default. Do not create raw markdown artifacts for them unless there is meaningful raw output worth preserving.
The stable published artifact for a successful round is always `rounds/<n>/codex-review.md`. Blocked and stalled artifacts are historical retry evidence and should not replace that canonical success path.

## Temp File Policy

Keep `/tmp` usage minimal:
- use `/tmp/code-review-<review-id>-r<round>-codex.*` for live detached `codex review` log, pid, exit, and metadata files
- use temporary issue-body files only when actually creating GitHub issues
- do not use `/tmp/code-review-triage-*`, `/tmp/code-review-fix-*`, or `/tmp/code-review-verify-*` by default

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
- `innerCycle`
- `cycleSource`
- `adapter`
- `strategy`
- `criticalCount`
- `importantCount`
- `minorCount`
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

External review steps also record:
- `provider` and `providerIndex`
- `reviewMode`, `reviewTarget`, `baseRef`, and `effectiveReviewTarget`
- `mergeBaseCommit`, `snapshotCommit`, and `snapshotRef` for branch-stack snapshots
- `reviewInputFingerprint` and `reviewedFiles`
- `sameProviderRerunBlocked`, `reviewInputFingerprintChanged`, `repeatClassification`, `repeatOverlap`, and `repeatedFindingKeys` when rerun/repeat guards apply
- `failureClassification` and `failureSubtype` for blocked runtime failures

Supported phases:
- `setup`
- `external_review`
- `main_agent_triage`
- `main_agent_fix`
- `main_agent_verify`
- `inner_receive_review`
- `inner_plan`
- `inner_execute`
- `inner_request_review`
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
1. record `started` when the detached subprocess begins
2. record `stalled` when the managed waiter reports no observable progress for 15 minutes
3. record the terminal result as `clean`, `issues_found`, `failed`, or `blocked`
4. only record `waiting` when the durable trace genuinely needs the state transition; it should not drive user-facing updates

For Codex `blocked` states:
- treat raw CLI/runtime failures as provider evidence, not parsed code findings
- keep the blocked artifact so auth, sandbox, or CLI failures remain inspectable later

For user choices:
- record `final_summary` with `status "needs_user_decision"` when the workflow pauses for an answer
- once the user answers, record a `user_decision` step with:
  - `question`
  - `answer`
  - `result`
- if the user stops the loop, record a later `final_summary` with `status "stopped"`

## Workflow Invariants

Shared run artifacts are the only durable context bus across outer review, inner adapter phases, and deep review.
Embedded child skills may contribute behavior and artifacts, but they must not own lifecycle transitions, closeout, or next-step decisions.
Accepted inner findings from `inner_receive_review.findings` are written to `finding-memory.jsonl` as `accepted_fix`, and later `main_agent_fix` or `inner_execute` steps resolve the same ledger row by normalized finding key.
Only unresolved `deferred` and `false_positive` entries are surfaced through prior-reviewed context; accepted fixes stay out of that reuse set.

The report and status logic treat these as hard requirements:
- every `main_agent_fix` must be followed by a same-round `main_agent_verify` before the next external review, deep review, user decision, or final closeout
- every new `external_review` event should use the canonical wrapper title `Round N / External Review`; older durable run titles must remain resumable when a run crosses a skill update
- when the latest meaningful event is `external_review` with `status "started"`, the only legal next action is to resume or wait that same round until it reaches a terminal state
- `external_review started` is never sufficient for final user-facing closeout; the parent agent must use `run-boundary-step.mjs --action wait` before sharing any terminal outer-review status
- only a clean Codex external review can unlock deep review or final closeout
- completed closeout cannot be recorded before the latest clean Codex external review
- deep-review findings must be represented in structured event fields, not only prose

If an invariant is violated, the tracked report must show it under workflow violations, and the run must not report `ready`.

Illegal pause rule:
- A run must not stop with the latest meaningful event equal to `external_review started`, `external_review issues_found`, `inner_execute completed`, or `inner_request_review` with non-zero findings.
- When that shape occurs, either resume the active outer review or record `final_summary` with `status "needs_user_decision"`, depending on what the boundary helper reports as the only legal next move.

## Path Rules

- `run-dir` must be a direct child of `docs/tool-output/code-review/`
- artifact destinations must stay inside the selected run directory
- raw artifact destinations are unique unless they are retry-versioned paths under `verification/`, historical blocked/stalled review artifacts, or same-round `main-agent-fix` / `main-agent-verify`
