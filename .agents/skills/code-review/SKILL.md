---
name: code-review
description: Use when reviewing local code changes, branch diffs, pull requests, or explicit files for correctness, security, performance, maintainability, test coverage, AI slop, or release readiness.
---

# Code Review

Produce one prioritized queue of actionable findings for the requested code target, then autonomously fix accepted in-scope findings and rerun review until clean, blocked, or a user decision is required, unless the user explicitly asks for review-only or no edits. This skill does not create, ship, merge, push, or update PRs/issues.

## Quick Reference

| Situation | Do |
|---|---|
| Target or base unclear | Stop and ask |
| Sensitive files in scope | Report paths only; do not read contents |
| User explicitly asks review-only, findings-only, no edits, or audit-only | Review and report findings; do not edit |
| bundled code-review helpers exist | Use External Codex adapter |
| Starting a routine closeout review after preflight confirms the dirty worktree/current branch is the intended target | Use `run-closeout-review.mjs` with no flags, optionally `--check "<command>"` |
| External Codex finds issues | Validate, auto-fix accepted in-scope items, verify, inner review, rerun Codex |
| First External Codex round is clean | Run one deep review before clean closeout |
| Accepted fix is safe and in scope | Fix without asking |
| Finding is uncertain, UX/product-changing, false-positive, broad, or repeated | Ask or stop with `needs_user_decision` |
| Verification unavailable | Return `blocked` with command and reason |

## Workflow

1. Read `references/workflow.md` before starting. It owns target resolution, preflight, review passes, fix loop, verification, and closeout.
2. Read `references/review-rubric.md` before reviewing.
3. Read `references/adapters.md` before non-manual review sources. If a relevant adapter exists, run it or report why skipped.
4. Use `references/review-queue-format.md` for the consolidated queue.
5. Use `references/stop-conditions.md` whenever scope, safety, async review, verification, or repeated findings get uncertain.

## Hard Rules

- Do not commit, push, merge, create a PR, or update an issue unless the user separately asks.
- Do not expand from the requested target into repo-wide cleanup.
- Do not read or transmit sensitive local artifacts.
- Do not substitute manual `git diff` review for available bundled External Codex helpers.
- Do not claim `clean`, `ready`, `passing`, or `fixed` without fresh verification output.
- Do not downgrade real findings into follow-up work just to produce a clean verdict.
- Do not pause for user approval before fixing an accepted, in-scope, low-risk finding.
- Do not close out until every applicable conditional adapter is accounted for as `ran` or `skipped:<reason>` in the TLDR/report.

## Common Mistakes

- Starting in branch mode, then rerunning later rounds against only uncommitted changes.
- Letting a clean first External Codex round skip deep review.
- Asking the user to approve routine accepted fixes that are clearly in scope.
- Fixing external findings before validating them against the codebase.
- Leaving UI, React/Next, simplify, security, or data-integrity adapters implicit instead of reporting `ran` or `skipped:<reason>`.
- Mixing PR shipping, issue updates, or bot commits into this review-only workflow.
- Continuing a repeated finding loop instead of stopping with `needs_user_decision`.

## References

- `references/workflow.md` - main review workflow.
- `references/review-queue-format.md` - queue schema and examples.
- `references/review-rubric.md` - review angles and conditional checks.
- `references/stop-conditions.md` - stop, pause, and escalation rules.
- `references/adapters.md` - optional repo-local review adapters and exact command contracts.
- `references/artifacts.md` - durable review artifact contract.
- `references/record-templates.md` - exact event recording commands.
- `references/final-summary.md` - generated report and closeout semantics.
