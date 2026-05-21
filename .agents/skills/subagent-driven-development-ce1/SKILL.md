---
name: subagent-driven-development-ce1
description: Manual-only experimental trial skill. Use only when the user explicitly invokes $subagent-driven-development-ce1 to compare CE1 implementation behavior.
---

# Subagent-Driven Development CE1

Run the stable subagent-driven-development workflow, then add Compound Engineering Phase 1 review checkpoints after each task-level code quality review and after the final integrated code review.

This is an experimental trial skill. Use it when the user explicitly invokes `$subagent-driven-development-ce1` or asks to compare CE1 against the stable implementation flow.

## Workflow

1. Read and follow `../subagent-driven-development/SKILL.md` first.
2. Execute the normal SDD loop: implementer, spec compliance review, code quality review, and review fixes for each task.
3. Read `../code-review-ce1/references/ce1-review-matrix.md` before CE1 routing.
4. After each task-level code quality review passes and the task produced a code diff, classify that task diff with the CE1 matrix.
5. Invoke the CE reviewers that match the task diff.
6. Record task-level CE1 reviewers, skipped reviewers, added findings, confirmed findings, and net effect.
7. If a task-level CE1 finding requires code changes, apply the fix, rerun spec compliance review plus code quality review, then rerun CE1 routing before marking the task complete.
8. After the final integrated code review, classify the combined diff with the CE1 matrix.
9. Invoke the CE reviewers that match the final integrated diff.
10. If a final CE1 finding requires code changes, apply the fix, rerun the final integrated code review, then rerun CE1 routing on the updated final diff.
11. Add a `CE1 contribution` section to the final implementation report.

## Hard Rules

- Do not change the stable `subagent-driven-development` workflow.
- Do not run CE1 before spec compliance and code quality review pass for the task under review.
- Do not move to the next task while any valid CE1 finding for the current task remains unresolved, unless it is explicitly deferred.
- Do not run specialist reviewers unless the diff clearly matches their domain.
- Do not count duplicated findings as new findings.
- Do not hide a skipped or failed CE1 reviewer. Report it in the CE1 contribution section.

## Final Report Requirement

Every `$subagent-driven-development-ce1` run must include:

- `CE1 contribution`
- `task-level CE1 reviewers`
- `final CE1 reviewers`
- `Reviewers skipped`
- `Findings added by CE1`
- `Findings confirmed by CE1`
- `Net effect`

If CE1 adds no findings, say that directly.
