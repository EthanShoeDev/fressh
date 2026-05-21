---
name: code-review-ce1
description: Manual-only experimental trial skill. Use only when the user explicitly invokes $code-review-ce1 to compare CE1 review behavior.
---

# Code Review CE1

Run the stable code-review workflow, then add the Compound Engineering Phase 1 review matrix and contribution report.

This is an experimental trial skill. Use it when the user explicitly invokes `$code-review-ce1` or asks to compare CE1 against the stable code review flow.

## Workflow

1. Read and follow `../code-review/SKILL.md` first.
2. Complete the normal code-review target resolution, scope, rubric, adapter accounting, and initial finding queue.
3. Read `references/ce1-review-matrix.md` before starting CE1 routing.
4. Classify the reviewed diff with the CE1 matrix.
5. Invoke the CE reviewers that match the matrix.
6. Merge valid CE1 findings into the normal review queue without double-counting duplicates.
7. Resolve, verify, and rerun review for accepted in-scope CE1 findings before final closeout.
8. Add a `CE1 contribution` section to the final report.

## Hard Rules

- Do not change the stable `code-review` workflow.
- Do not run CE1 before the normal review establishes scope and risk.
- Do not close out while any valid in-scope CE1 finding remains unresolved, unless the user explicitly requested review-only or no-edit scope.
- Do not run specialist reviewers unless the diff clearly matches their domain.
- Do not count duplicated findings as new findings.
- Do not hide a skipped or failed CE1 reviewer. Report it in the CE1 contribution section.

## Final Report Requirement

Every `$code-review-ce1` run must include:

- `CE1 contribution`
- `Reviewers run`
- `Reviewers skipped`
- `Findings added by CE1`
- `Findings confirmed by CE1`
- `Net effect`

If CE1 adds no findings, say that directly.
