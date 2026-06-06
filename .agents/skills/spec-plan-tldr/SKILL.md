---
name: spec-plan-tldr
description:
  Use when summarizing a specification, implementation plan, PR design/plan
  handoff, or approval packet where the user needs concise approval-oriented
  understanding of behavior, UX, data, code impact, contracts, risks, or
  spec-plan alignment.
---

# Spec Plan TLDR

## Overview

Produce a concise, approval-oriented TLDR for a specification, an implementation
plan, or both. Optimize for what the user must understand to approve or correct
the work: behavior, UX, data, code impact, contracts, risks, and alignment.

## Required Grounding

- Read the referenced artifact contents before summarizing.
- For a PR, inspect the PR body and changed spec/plan files.
- Do not infer plan details from a spec-only input. Mark inferred behavior as
  inferred when needed.
- When both spec and plan are present, compare the plan against the spec.
- Use the generic `tldr` skill instead for ordinary issue comments,
  customer-facing summaries, or non-technical simplification without spec/plan
  approval needs.

## Output Shape

Use adaptive sections. Include only relevant sections, except that `UX impact`,
`Database/data impact`, and `Code impact` must appear for plan or spec+plan
summaries. If no impact is stated, say so explicitly.

Preferred order:

- **What changes:** post-implementation behavior in one or two bullets.
- **Why:** current problem or reason.
- **UX impact:** screens, flows, labels, disabled/error states, permissions, or
  user-visible behavior. Say `No UX change stated` when applicable.
- **Database/data impact:** schema, migrations, indexes, stored payloads,
  backfills, data integrity, existing-data treatment. Say
  `No database/data change stated` when applicable.
- **Code impact:** code areas grouped by responsibility, behavior ownership,
  call-flow changes, shared helpers/contracts, complexity added/removed, and
  likely regression surface.
- **Contract/API impact:** inputs, outputs, events, feature flags, permissions,
  CLI flags, stored JSON, external integrations.
- **Spec-plan alignment:** only when both are provided; note coverage, gaps,
  deviations, and extra scope.
- **Risks/open questions:** assumptions, edge cases, rollout/backout concerns,
  unresolved decisions.
- **Approval checklist:** concise statements the user should confirm.

Verification details are secondary. Include them only when they affect approval
confidence. Do not include plan phases as a default section.

## Code Impact Standard

For plan and spec+plan summaries, the code-impact section must answer:

- What code areas change, grouped by responsibility rather than every file.
- Where the new rule or behavior will live.
- Whether logic is centralized, duplicated, moved, or deleted.
- How data/control flow changes.
- Which shared contracts or types change.
- Whether the plan simplifies code, adds branching, introduces abstractions, or
  removes old paths.
- Which existing behavior is most likely to regress.

If the artifact is too vague to answer this, say `Code impact underspecified`.

## Style Rules

- Be concise. Prefer bullets.
- Preserve source meaning and scope.
- Surface small UX/database changes instead of burying them.
- Distinguish `none stated` from `none`.
- Use exact identifiers only when needed for approval.
- Avoid task-by-task checklists, long command lists, code snippets, and line
  numbers unless critical.
- Keep the skill generic; examples must not become domain rules.
