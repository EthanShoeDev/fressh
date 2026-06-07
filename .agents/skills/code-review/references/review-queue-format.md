# Review Queue Format

Create one consolidated queue. Each item must be actionable, scoped, and supported by evidence.

## Fields

- **ID:** stable short identifier, such as `CR-1`.
- **Severity:** `Critical` | `Bug` | `Data integrity` | `API contract` | `Perf` | `Tests` | `Maintainability` | `Style` | `Needs clarification`.
- **Title:** short specific problem statement.
- **Location:** best pointer available, such as `path:line`, component, function, migration, route, or test.
- **Evidence:** what was observed in the diff, code, test output, runtime output, or docs.
- **Source:** review pass that found it, such as core, security, data, API, perf, tests, UI, AI-slop, external-codex, review-profile, ci, pr-comment, external.
- **Artifacts:** optional paths to durable evidence, such as review `events.jsonl`, external review markdown, CI output, screenshots, or review-comment JSON.
- **Recommendation:** concrete change to make.
- **Acceptance criteria:** observable condition that proves the item is resolved.
- **Verification:** smallest command or manual check that validates the fix.
- **Decision:** `Auto-fix` for accepted in-scope fixes, or `Ask`, `Skip`, `Defer`, `Clarify`, or `False positive` when a user decision or documented rejection is required.
- **Status:** `Open` | `In progress` | `Done` | `Skipped` | `Deferred` | `Blocked`.

## Prioritization

Order by likely user or production impact:

1. Security, privacy, auth, data loss, or permission bypass.
2. Correctness bugs and behavior regressions.
3. Data integrity, migrations, persistence, and writes.
4. API or contract compatibility.
5. Performance and scalability.
6. Missing or weak verification.
7. Maintainability, simplicity, dead code, duplication.
8. Style-only issues.

## Example

```text
ID: CR-1
Severity: Bug
Title: Guard missing organization id before loading dashboard data
Location: src/app/dashboard/page.tsx:42
Evidence: The new data loader assumes orgId is defined, but the route can render before org context resolves.
Source: core
Artifacts: docs/tool-output/code-review/code-review-123/rounds/1/codex-review.md
Recommendation: Return the existing empty/loading state until orgId is present.
Acceptance criteria: The dashboard no longer throws when org context is initially absent.
Verification: yarn test:frontend -- dashboard && yarn cq
Decision: Auto-fix
Status: Done
```

## De-duplication

- Merge duplicate reports that share the same root cause.
- Keep the strongest evidence and list multiple sources in `Source`.
- If two findings disagree, mark the item `Needs clarification` and explain the conflict.
- Do not create separate items for formatting or naming details that are part of the same concrete fix.
