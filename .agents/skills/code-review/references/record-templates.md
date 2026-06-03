# Record Templates

Load this only when you are about to write a `run-artifacts.mjs record` event and want the exact command shape.

Use inline flags by default. Use `--details-file` only when the reasoning or raw output is long enough to justify a saved body.
Temp-file policy stays in `references/artifacts.md`.

## Contents

- Setup
- Boundary Check
- Boundary Closeout
- Inner Receive Review
- Inner Plan
- Inner Execute
- Inner Request Review
- Main-Agent Triage
- Main-Agent Fix
- Main-Agent Verify
- User Decision
- Final Summary

## Setup

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Setup" \
  --phase "setup" \
  --status "started" \
  --action "Initialized the durable run and selected the initial review target." \
  --note "Review mode: <uncommitted|branch-stack>" \
  --note "Initial review target: <literal target>" \
  --note "Later reviews keep the same persisted review mode and resolve a fresh effective target from it." \
  --timestamp "<timestamp>"
```
## Boundary Check

```bash
node .agents/skills/code-review/scripts/run-boundary-step.mjs \
  --run-dir "<run-dir>" \
  --repo-root "<repo-root>" \
  --action "check" \
  --timestamp "<timestamp>"
```

## Boundary Closeout

```bash
node .agents/skills/code-review/scripts/run-boundary-step.mjs \
  --run-dir "<run-dir>" \
  --repo-root "<repo-root>" \
  --action "close-if-illegal" \
  --timestamp "<timestamp>"
```


## Inner Receive Review

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Inner Cycle <c> / Receive Review" \
  --phase "inner_receive_review" \
  --round "<n>" \
  --inner-cycle "<c>" \
  --cycle-source "outer_codex_findings|deep_review_findings" \
  --adapter "receiving-code-review" \
  --status "completed" \
  --purpose "Validate external-review findings before fixing." \
  --result "<short result>" \
  --details-file "<optional long-form notes>" \
  --timestamp "<timestamp>"
```

## Inner Plan

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Inner Cycle <c> / Inner Plan" \
  --phase "inner_plan" \
  --round "<n>" \
  --inner-cycle "<c>" \
  --cycle-source "outer_codex_findings|deep_review_findings" \
  --adapter "writing-plans" \
  --strategy "planned" \
  --status "completed" \
  --purpose "Write a plan for the complex fix path." \
  --result "<short result>" \
  --details-file "<optional plan notes>" \
  --timestamp "<timestamp>"
```

## Inner Execute

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Inner Cycle <c> / Inner Execute" \
  --phase "inner_execute" \
  --round "<n>" \
  --inner-cycle "<c>" \
  --cycle-source "outer_codex_findings|deep_review_findings" \
  --adapter "<direct-fix adapter name or executing-plans>" \
  --strategy "direct-fix|planned" \
  --status "completed|failed" \
  --purpose "Apply the chosen fix strategy for this inner cycle." \
  --fix-now "<item resolved by this execute step>" \
  --command "<execute command or summary>" \
  --result "<short result>" \
  --details-file "<optional execution notes>" \
  --started-at "<timestamp>" \
  --ended-at "<timestamp>" \
  --timestamp "<timestamp>"
```

## Inner Request Review

Use either success label that the runtime emits: `status "clean"` or `status "completed"` with zero critical, important, and minor counts. Treat both as the same successful zero-finding state.

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Round <n> / Inner Cycle <c> / Request Review" \
  --phase "inner_request_review" \
  --round "<n>" \
  --inner-cycle "<c>" \
  --cycle-source "outer_codex_findings|deep_review_findings" \
  --adapter "requesting-code-review" \
  --critical-count "0" \
  --important-count "0" \
  --minor-count "0" \
  --status "clean|completed" \
  --purpose "Re-review the current fixes before returning to Codex." \
  --result "0 critical, 0 important, 0 minor findings." \
  --timestamp "<timestamp>"
```

## Main-Agent Triage

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
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

## Main-Agent Fix

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
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

## Main-Agent Verify

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
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

## User Decision

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Batch Decision" \
  --phase "user_decision" \
  --status "completed" \
  --question "<the exact boundary question that was asked>" \
  --answer "<user answer>" \
  --result "<what the workflow will do next>" \
  --timestamp "<timestamp>"
```

## Final Summary

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs record \
  --run-dir "<run-dir>" \
  --title "Final Summary" \
  --phase "final_summary" \
  --status "completed|needs_user_decision|stopped|blocked" \
  --purpose "Record the final status of the run." \
  --result "<short result>" \
  --note "<short closeout note when helpful>" \
  --timestamp "<timestamp>"
```
