# Process Report Contract

Read this before the final summarize step.

## Source Of Truth

The tracked process report is generated from:
- `docs/tool-output/rloop-code-fix/<review-id>/events.jsonl`

Refresh it with:

```bash
node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs summarize \
  --run-dir "<run-dir>"
```

Do not hand-edit `docs/run/rloop-code-fix-<review-id>.md`.

## What The Tracked Report Must Answer

The tracked report should let the next reviewer understand:
- what happened in each round
- how long each round and step took
- what findings were reported
- how each finding was classified
- what was fixed
- what was intentionally deferred
- what was rejected and why
- what user answers changed the loop
- whether the branch is ready, blocked, stopped, or waiting on a decision

## Required Sections

The tracked report is expected to contain:

### Current State
- review ID
- run directory
- event-log path
- tracked-report path
- suggested final status
- started at / ended at / total duration
- rounds run
- current external review round
- current batch window
- latest external review status
- whether a clean external review was achieved
- whether deep review ran
- latest verification status and result

### Workflow Violations

Either:
- `- None`

Or a list of concrete workflow problems, such as:
- fix round advanced without a persisted same-round verify
- completed closeout recorded before the latest clean external review

### Latest External Review Findings

Show the most recent external-review findings exactly as recorded.

### Follow-Up State

Separate lists for:
- deferred in current PR
- suggested separate issues
- known rejected findings

### User Decisions

Show each recorded `user_decision` with:
- question
- answer
- effect/result
- timestamp when available

### Round Report

A table with one row per round showing:
- total round duration
- external review duration
- triage duration
- fix duration
- verify duration
- findings count
- fixed-now count
- deferred count
- separate-issue count
- rejected false-positive count
- verification status
- short round outcome

### Full Timeline

Render every step in event order, including:
- setup
- round steps
- deep review
- user decisions
- final closeout

Each step should show the saved artifact path when one exists, so the next reviewer can inspect raw evidence if needed.

### Draft GitHub Issues

When `separate_issue` items remain, include draft issue titles and bodies.

### Artifact Index

Always include:
- `events.jsonl`
- the tracked process report path
- every saved raw artifact path recorded by the run

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
- `needs_user_decision`: workflow is paused on a real decision
- `stopped`: user explicitly stopped the loop
- `blocked`: verification failed or workflow invariants were violated
- `in_progress`: work is still proceeding normally and no terminal status has been reached yet
