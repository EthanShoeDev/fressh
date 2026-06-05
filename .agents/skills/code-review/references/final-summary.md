# Process Report Contract

Read this before the final summarize step.

## Contents

- Source Of Truth
- What The Tracked Report Must Answer
- Required Sections
- Never Render In The Compact Report
- Clustered Batch Postmortem Contract
- Final Status Semantics
- Closeout Rules

## Source Of Truth

The tracked process report is generated from:
- `docs/tool-output/code-review/<review-id>/events.jsonl`

Refresh it with:

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs summarize \
  --run-dir "<run-dir>"
```

Do not hand-edit `docs/run/code-review-<review-id>.md`.

The markdown report is now a compact summary for humans. It is not the full audit trail. If a reviewer needs every step, raw event order, or every saved artifact, they should inspect `events.jsonl` and the run directory under `docs/tool-output/...`.

## What The Tracked Report Must Answer

The tracked report should let the next reviewer understand:
- whether the branch is ready, blocked, stopped, in progress, or waiting on a decision
- what real issues were fixed
- what findings were rejected, deferred, or moved to separate follow-up work
- how each review round ended
- what the next action is

## Required Sections

The tracked report must contain only these sections, in this order:

### After Each Round Expectations

After any round-complete state, the regenerated tracked report MUST be the current human-readable status report for the run. Round-complete states are: terminal `external_review` results, `main_agent_verify`, and any `final_summary` event. At those points, `docs/run/code-review-<review-id>.md` must be current, readable on its own, and reusable as-is for user-visible status sharing such as PR comments or boundary summaries. In-progress states such as `started` do not need to meet that bar.
`external_review started` is never enough for final user-facing closeout. The parent agent must run `run-boundary-step.mjs --action wait` and wait for the terminal outer-review state before sharing any final status.
If a child session leaks wait-only text such as `started, not finished` or `keep waiting/resuming session`, treat that as nonterminal noise rather than closeout evidence. Only a real terminal outer-review state may drive the final user-facing summary.

### Header Summary

Two lines:
- line 1: review id, final status, round count, latest Codex verdict, deep-review state, verification state, total duration
- line 2: compact counts for fixed, rejected, deferred, separate, and user decisions. Fixed counts include items from `main_agent_fix` and `inner_execute`

Use emoji only for high-signal state:
- `✅` ready, clean, pass, ran
- `⚠️` issues found, needs decision, stalled
- `⛔` blocked, fail
- `⏸` stopped
- `🔄` in progress / started
- `➖` not run / n/a

### Important Items

Only render non-empty subsections:
- `### Fixed Now`
- `### Rejected Findings`
- `### Deferred`
- `### Separate Issues`
- `### Current Blockers`

Each subsection is a compact table:
- `Fixed Now`: `Round | Item | Resolution`
- `Rejected Findings`: `Round | Item | Reason`
- `Deferred`: `Round | Item | Reason`
- `Separate Issues`: `Round | Item | Why separate`
- `Current Blockers`: `Round | Item | Reason`

If a subsection would exceed 6 rows, keep the first 6 rows and add one final overflow row pointing the reader to `events.jsonl`.

### Round Summary

One table with one row per round:
- `Round | Provider | Verdict | Findings | Fixed | Rejected | Verify | Outcome`

Rules:
- `Verdict` and `Verify` may include emoji
- `Outcome` must be a short sentence fragment, not a paragraph
- when inner adapter phases occurred in a round, `Outcome` must mention the compressed adapter flow, for example `adapter: receive -> execute -> request(0/0/0)`
- do not render the old per-phase duration breakdown in this table

### Decision Or Closeout

Use exactly one section:
- `## Next Step`
- `## Decision Needed`

Use `Decision Needed` only when the suggested final status is `needs_user_decision`.
Use `Next Step` for all other states.

If the latest `final_summary.details` contains clustered-batch analysis:
- do not re-render the full postmortem headings in the report
- compress the recommendation into the one decision/closeout paragraph

### Options

Only render `## Options` when the user has a real pending choice, usually for:
- `needs_user_decision`
- `blocked`

Format:
- table with `Choice | Effect`

Use the recommended next step first when it exists in `final_summary.details`.

### Evidence

Keep this short. Include only:
- `events.jsonl`
- the latest relevant external-review artifact
- blocked/stalled external-review artifacts when they explain the current state
- `deep-review/` when deep review ran

## Never Render In The Compact Report

Do not include:
- `Current State`
- `Workflow Violations` as a standalone section
- `Latest External Review Findings`
- `Latest Postmortem`
- `User Decisions`
- `Deep Review Summary`
- `Full Timeline`
- `Draft GitHub Issues`
- a full `Artifact Index`

If workflow violations exist, surface them under `### Current Blockers`.

## Clustered Batch Postmortem Contract

The boundary `final_summary.details` may still record structured postmortem headings such as:
- `## What Kept Recurring`
- `## Real Progress Vs Churn`
- `## Likely Root Cause`
- `## Test Matrix Gaps`
- `## Requirement Or Invariant Gaps`
- `## Recommended Next Step`
- `## Alternative Next Steps`

Those headings remain valid in the event log details, but the compact report should only extract:
- the recommended next step
- the alternative next steps when a user choice is required

## Final Status Semantics

The generated report derives a suggested final status from the latest events:
- `ready`
- `ready_with_follow_ups`
- `needs_user_decision`
- `stopped`
- `blocked`
- `in_progress`

Interpret them as:
- `ready`: latest external review is clean, deep review ran when required, closeout is completed, and no follow-ups remain
- `ready_with_follow_ups`: latest external review is clean, deep review ran when required, closeout is completed, and deferred/separate issues remain
- `needs_user_decision`: workflow is paused on a real decision, such as the next 5-round batch decision or a clustered-batch follow-up choice
- `stopped`: user explicitly stopped the loop or paused it to work the recommended follow-up outside the current invocation
- `blocked`: verification failed or workflow invariants were violated
- `in_progress`: work is still proceeding normally and no terminal status has been reached yet

## Closeout Rules

- Record `status "completed"` only after the latest external review is clean and any separate-issue creation decision has been handled.
- Record `status "completed"` only after the latest external review has reached its terminal state and the parent agent has used `run-boundary-step.mjs --action wait` to obtain that terminal status.
- Record `status "needs_user_decision"` when waiting on the next 5-round batch decision, the clustered-batch follow-up decision, or the “create GitHub issues?” decision.
- Record `status "stopped"` when the user explicitly stops the loop or pauses it for a recommended follow-up.
- The tracked process report must not reach `ready` or `ready_with_follow_ups` without a completed `final_summary` event.
- If a completed closeout is recorded before the latest clean external review, the report should surface the violation under `### Current Blockers` and remain blocked.
