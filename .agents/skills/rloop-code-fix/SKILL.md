---
name: rloop-code-fix
description: Use when uncommitted code changes need automated review before commit, but the main agent should stay responsible for triage, fixes, and verification.
---

# Review-First Code Fix Loop

Use external Codex for fresh review only. The main agent owns the decisions, code edits, verification, and user communication in one continuous context.

This skill is durable by default. Every run must leave a clear record under:
`docs/tool-output/rloop-code-fix/<review-id>/`

## When to Invoke

- User runs `/rloop-code-fix`
- User wants independent review of local changes before commit
- User wants help deciding what to fix now, what to defer, and what to move into a separate issue

## Core Rules

- External Codex is used for `codex review` only in the normal workflow.
- The main agent performs all triage, all code edits, and all verification.
- Do not use `codex exec` or `codex exec resume` for fixes in the normal path.
- A passing local verify is not enough to close the run. The loop must get a later `codex review --uncommitted` result of `clean` before it can move to deep review or final closeout.
- Run external review in batches of 5 rounds: `1-5`, then `6-10`, then `11-15`, and so on. If the latest external review is still not clean at the end of a batch, stop and ask the user whether to continue with another 5-round batch or exit as-is.
- Do not silently ignore `P3`. Every finding must be classified and explained.
- If a finding is real but outside the current PR scope, record it as a separate-issue suggestion instead of expanding scope silently.
- Rejected findings must be recorded in both the durable run and the repo-tracked process report so later `codex review --uncommitted` rounds can see the prior rationale.
- Add a short code comment only when a rejected finding depends on a non-obvious local invariant or deliberate edge-case choice.
- If many findings cluster into one root cause or design smell, stop and explain that the current approach may be wrong before continuing.
- If separate-issue items remain at the end, list them to the user and ask whether to create GitHub issues so they are not forgotten.
- After every round, give the user a short progress update:
  - current round number and current 5-round batch window
  - how many real issues were found
  - what is being fixed now
  - what is deferred
  - what was rejected and why
  - what should become a separate issue
  - whether the loop is continuing automatically or pausing for a decision

## References

- `references/artifacts.md` - event log schema, generated reports, and saved artifact paths
- `references/final-summary.md` - what the tracked process report must show
- `../shared/long-running-subprocess.md` - standard wait/resume behavior for healthy long-running subprocesses

## External Review Wait Policy

For `codex review`:
- keep waiting automatically while the subprocess is still making observable progress
- treat no progress for 15 minutes as stalled
- give state-change-only progress updates while waiting
- if the review stalls, exits ambiguously, or fails in a way that needs a choice, ask the user what to do
- do not silently fall back to another path

## Workflow

### Step 1: Setup

Read `references/artifacts.md`.

Create a new durable run:

```bash
REVIEW_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | head -c 8)
RUN_DIR=$(node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs init --review-id "${REVIEW_ID}")
```

After this, use the literal `<review-id>` and `<run-dir>` values in later commands. Do not assume shell variables persist across tool calls.

The helper also generates a repo-tracked process report at:
`docs/run/rloop-code-fix-<review-id>.md`

Do not delete it during the loop. It is intentionally part of the reviewed diff so later external review rounds can see the prior decisions, user answers, and current workflow state.
It is the only human-readable generated report you should rely on. Raw transcripts and logs stay under `docs/tool-output/...`.

Determine the initial review target:
- default: `--uncommitted`
- if the user asked for a base branch: `--base <branch>`
- if the user asked for a specific commit: `--commit <sha>`

After the first main-agent code edit, all later external reviews must use `--uncommitted`.

Record setup:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Setup" \
  --phase "setup" \
  --status "started" \
  --action "Initialized the durable run and selected the initial review target." \
  --note "Initial review target: <literal target>" \
  --note "Later reviews switch to --uncommitted after the first write." \
  --timestamp "<timestamp>"
```

### Step 2: Round N / External Review

Read `../shared/long-running-subprocess.md` before the first external review.

Run external Codex review against the current effective target:

```bash
set -o pipefail

codex review <effective-review-target> 2>&1 | tee /tmp/rloop-review-<review-id>.md | tail -80
```

If the terminal tool returns a live session instead of a completed review:
- do not ask the user to press continue
- record an `external_review` event with `status "started"` as soon as the subprocess is running
- keep polling the live session yourself
- inspect the tee'd log after each poll with:

```bash
node .agents/skills/shared/scripts/subprocess-log-status.mjs \
  --log "/tmp/rloop-review-<review-id>.md" \
  --tail 40
```

If you already know the previous log size/update time, compare against it:

```bash
node .agents/skills/shared/scripts/subprocess-log-status.mjs \
  --log "/tmp/rloop-review-<review-id>.md" \
  --tail 40 \
  --baseline-size "<previous-size-bytes>" \
  --baseline-updated-at "<previous-updated-at>"
```

While the helper reports progress:
- keep waiting automatically
- continue using state-change-only commentary
- optionally record a `waiting` event when the wait state changes in a way the final trace should preserve

If there has been no observable progress for 15 minutes:
- record an `external_review` event with `status "stalled"`
- explain that the process is no longer progressing
- ask the user whether to keep waiting, inspect more deeply, or stop

Do not ask the user for a manual continue while the subprocess is healthy.

When the subprocess completes with a usable verdict, persist the final review:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --source "/tmp/rloop-review-<review-id>.md" \
  --dest "rounds/<n>/codex-review.md" \
  --title "Round <n> / External Review" \
  --phase "external_review" \
  --round "<n>" \
  --status "clean|issues_found" \
  --purpose "Review the current diff from a fresh external Codex context." \
  --result "<short result>" \
  --command "codex review <effective-review-target>" \
  --finding "<item when the review reported one>" \
  --note "<short note when helpful>" \
  --session-id "<session-id-if-known>" \
  --started-at "<timestamp>" \
  --ended-at "<timestamp>" \
  --timestamp "<timestamp>"
```

Only pass `--findings-file` or `--notes-file` when those scratch files already exist. Otherwise use repeated `--finding` / `--note` flags or omit them.

If the subprocess exits without a usable review verdict:
- record an `external_review` event with `status "blocked"`
- explain why the result is ambiguous
- ask the user what to do next

If the review is clean:
- if the deep review checkpoint has not run yet, go to Step 6
- otherwise go to Step 8

If the review finds actionable issues, continue to Step 3.

### Step 3: Round N / Main-Agent Triage

The main agent reads the external review and classifies every finding into exactly one bucket:
- `fix_now`
- `defer`
- `separate_issue`
- `reject_false_positive`

Rules:
- real issue and in scope -> `fix_now`
- real issue but not in PR scope -> `separate_issue`
- real issue worth keeping in the PR discussion but not fixing now -> `defer`
- not a real issue -> `reject_false_positive`
- every non-`fix_now` item must include a short reason

If the review found many related issues, stop and think before fixing linearly. Explain the likely design or test smell and decide whether to continue with the current approach or suggest a broader follow-up.

Persist triage:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Main-Agent Triage" \
  --phase "main_agent_triage" \
  --round "<n>" \
  --status "completed|needs_user_decision" \
  --purpose "Classify each finding into fix-now, defer, separate issue, or false positive." \
  --result "<short result>" \
  --fix-now "<item>" \
  --defer "<item>" \
  --separate-issue "<item>" \
  --false-positive "<item>" \
  --details-file "<optional long-form triage notes>" \
  --note "<short note when helpful>" \
  --started-at "<timestamp>" \
  --ended-at "<timestamp>" \
  --timestamp "<timestamp>"
```

Do not create `/tmp/rloop-triage-<review-id>.md` by default. Use inline fields and `--details-file` only when the reasoning is long enough to justify a saved body.

User update after triage:
- say the current round number and batch window
- say how many real issues were found
- say what is being fixed now
- say what is deferred
- say what was rejected and why
- say what should become a separate GitHub issue

If nothing is classified as `fix_now`:
- do not stop immediately
- keep the repo-tracked process report current so the next external review sees the rejection/defer rationale
- continue the loop automatically unless the current round ends the current 5-round batch window, the review stalled/blocked, or the user must decide about separate GitHub issues

### Step 4: Round N / Main-Agent Fix

Apply only the `fix_now` items in the current main-agent context.

Persist the fix round:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Main-Agent Fix" \
  --phase "main_agent_fix" \
  --round "<n>" \
  --status "passed|failed" \
  --purpose "Apply the approved fix-now items in the main-agent context." \
  --result "<short result>" \
  --fix-now "<original issue text that was resolved>" \
  --details-file "<optional implementation notes>" \
  --note "<what was applied or why>" \
  --started-at "<timestamp>" \
  --ended-at "<timestamp>" \
  --timestamp "<timestamp>"
```

Do not create `/tmp/rloop-fix-<review-id>.md` by default. Use inline fields and `--details-file` only when the implementation notes are long enough to justify a saved body.
Reuse the original issue text in `--fix-now` when a round resolves an earlier deferred or separate-issue item. Put implementation details in the saved artifact body or `--note`.

After this step, all later external reviews use `--uncommitted`.

### Step 5: Round N / Main-Agent Verify

Inspect the diff and run the relevant checks.

Verification status must be one of:
- `pass`
- `pass_no_applicable_tests`
- `fail`

Use `pass_no_applicable_tests` only when the scope genuinely does not have a meaningful test command. The verification notes must explain why.

Persist verification:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Main-Agent Verify" \
  --phase "main_agent_verify" \
  --round "<n>" \
  --status "passed|failed" \
  --verification-status "pass|pass_no_applicable_tests|fail" \
  --purpose "Verify the round-<n> fixes before deciding whether another review is needed." \
  --result "<short result>" \
  --command "<verification command or summary>" \
  --details-file "<optional long-form verification notes>" \
  --note "<why this verification status applies>" \
  --started-at "<timestamp>" \
  --ended-at "<timestamp>" \
  --timestamp "<timestamp>"
```

Do not create `/tmp/rloop-verify-<review-id>.md` by default. Persist the verify step directly. Save a raw verification artifact only when a command log is worth preserving.

If verification fails:
- triage the failure as a real issue
- fix it in the main-agent context
- verify again before another external review
- repeated same-round `main-agent-fix` and `main-agent-verify` artifacts auto-version as `*-attempt-<n>.md`

If verification passes:
- if the current round does not end the current 5-round batch window, go back to Step 2 and rerun `codex review --uncommitted`
- if the current round does end the current 5-round batch window and the latest external review was still not clean, go to Step 7 and ask the user whether to continue with another 5-round batch
- do not skip straight to deep review; only a clean external review unlocks Step 6

### Step 6: Deep Review Checkpoint

Run this once per skill invocation:
- after the first clean external review
- never before a clean external review

Checkpoint passes:
- `yarn cq` -> `deep-review/yarn-cq.md`
- `$code-review` -> `deep-review/code-review.md`
- `$web-design-guidelines` when relevant -> `deep-review/web-design-guidelines.md`
- `$vercel-react-best-practices` when relevant -> `deep-review/vercel-react-best-practices.md`
- main-agent manual review -> `deep-review/main-agent-manual-review.md`
- merged checkpoint findings -> `deep-review/merged-findings.md`

Record each checkpoint step with `--phase "deep_review"`.
If a checkpoint finds issues, record them in structured fields (`--fix-now`, `--defer`, `--separate-issue`, `--false-positive`) instead of leaving them only in prose.

If the checkpoint finds real issues:
- classify them with the same `fix_now/defer/separate_issue/reject_false_positive` rules
- fix the `fix_now` items in the main-agent context
- verify
- then go back to Step 2 and require another clean external review before final closeout
- do not rerun the deep review checkpoint a second time in the same invocation

If the checkpoint finds no real issues, continue normally.

### Step 7: Continue or Pause

Use this step only when a real decision is required:
- the current 5-round batch ended and the latest external review is still not clean
- the external review stalled or exited ambiguously
- separate-issue items remain and the user must decide whether to create GitHub issues for them

At a 5-round batch boundary with no clean external review:
- record a `final_summary` event with `status "needs_user_decision"`
- explain the latest external-review findings
- explain whether each latest finding is fix-now, defer, separate issue, or reject false positive
- ask whether to continue with another 5-round batch or exit as-is

When the user answers, record a `user_decision` event:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Batch Decision" \
  --phase "user_decision" \
  --status "completed" \
  --question "Continue with another 5-round batch or stop as-is?" \
  --answer "<user answer>" \
  --result "<what the workflow will do next>" \
  --timestamp "<timestamp>"
```

If the user chooses to stop as-is:
- record another `final_summary` event with `status "stopped"`
- explain why the loop is stopping and what latest findings remain
- rerun `summarize`

If the user approves another batch:
- keep the same run directory and same repo-tracked process report file
- continue with the next round number (`6`, `7`, ... then `10`, etc.)

If separate-issue items remain after the loop is otherwise ready:
- list them clearly for the user
- ask whether to create one GitHub issue per separate-issue item
- record the user answer with another `user_decision` event
- if the user says yes, copy each draft body from `docs/run/rloop-code-fix-<review-id>.md` into a `/tmp/rloop-separate-issue-<review-id>-<n>.md` file and create one issue per item with `./bin/core8 git issue create --title "<suggested title>" --body-file "/tmp/rloop-separate-issue-<review-id>-<n>.md"`
- record the created issue numbers in the final closeout event and regenerated reports
- if the user says no, keep them listed in the reports and close as ready with follow-ups

If the loop keeps surfacing adjacent issues that point to one root cause, pause and say so explicitly:
- “we keep finding related workflow issues”
- “this looks like a design or test smell”
- “we should improve X before continuing on this task”

### Step 8: Final Closeout

Generate the reports:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs summarize \
  --run-dir "<run-dir>"
```

This refreshes the canonical tracked process report at:
- `docs/run/rloop-code-fix-<review-id>.md`

Recording a `final_summary` event is required for closeout. Use:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Final Summary" \
  --phase "final_summary" \
  --status "completed|needs_user_decision|stopped|blocked" \
  --purpose "Record the final status of the run." \
  --result "<short result>" \
  --note "<short closeout note when helpful>" \
  --timestamp "<timestamp>"
```

Only pass `--notes-file` when that scratch file already exists.

Only record `status "completed"` after the latest clean external review has already been persisted.

Then run `summarize` again so the tracked process report reflects the final state.

Closeout rules:
- use `status "completed"` only after the latest external review is clean and any separate-issue creation decision has been handled
- use `status "needs_user_decision"` when waiting on the next 5-round batch decision or the “create GitHub issues?” decision
- use `status "stopped"` when the user explicitly decides to stop the loop as-is
- the tracked process report should not reach `ready` or `ready_with_follow_ups` without a completed `final_summary` event
- if a completed closeout is recorded before the latest clean external review, the report should show a workflow violation and remain blocked

### Step 9: Cleanup

Delete scratch files only. Never delete the durable run directory.

## Outcome Expectations

The saved reports must make it obvious:
- what issues were found in each round
- which issues were fixed now
- which were deferred and why
- which should become separate GitHub issues
- which were rejected as false positives
- how long each round took
- whether the branch is ready, blocked, or waiting on a user decision
