# Suggestion Scope Policy

## Scope Order

Prefer the lowest-risk patch that explains the failure:

1. `SKILL.md`
2. `references/`
3. `scripts/`

Do not touch `assets/` in v1.

## When To Target SKILL.md

Use `SKILL.md` for:

- trigger phrasing gaps
- missing workflow steps
- retry guardrails
- validation instructions
- output expectations

## When To Target references/

Use `references/` when:

- the skill needs a reusable checklist
- detailed trace-shape guidance would bloat `SKILL.md`
- examples or schemas are useful but not core to triggering

## When To Target scripts/

Only suggest script changes when the trace shows a repeated deterministic need, such as:

- the same log-parsing logic rewritten multiple times
- the same shell sequence repeated with small variations
- a reliable validation or redaction step that should not stay manual

Local fallback mode should not try to synthesize new script files. Emit the finding and suggest the script-level change only when the evidence supports it.

## Analysis Modes

- Judge mode: generate redacted evidence, run the default judge contract, and emit scored findings plus suggested change targets
- Local fallback mode: generate conservative findings and bounded change suggestions when the judge is disabled or fails

## Trace Resolution Policy

When auto-selecting a stored session log:

- Rank direct execution evidence above durable-artifact evidence, durable-artifact evidence above consult-path evidence, and consult-path evidence above declaration-only evidence.
- Count declaration markers only when the session shows real tool activity. Announcement-only sessions are not valid winners.
- Count artifact evidence only from command payloads, never from free-text mentions.
- Keep bare skill names scoped to the default `.agents` variant. Variant-agnostic declaration and artifact markers are reserved for explicit selectors.
- Preserve the caller's explicit selector intent:
  - explicit `.claude/...` selectors stay variant-strict
  - explicit in-repo paths keep repo-relative aliases
  - explicit external relative paths may match both their raw and resolved forms
- Use originator preference and recency only as tie-breakers after evidence ranking.

## Tiered Broadening Rules

- `SKILL.md` is the default suggestion target.
- `references/` is allowed only when the evidence points to reusable guidance, schemas, or long-form checklists.
- `scripts/` is allowed only when the evidence shows repeated deterministic work.
- `agents/openai.yaml` changes are reserved for routing or tooling metadata updates.
- Do not load the legacy patch schema unless you are debugging backward-compatibility behavior.

## Report Contract

Every analysis should:

- write a redacted `evidence.json` before the judge stage
- record structured change suggestions without mutating the target skill
- record rerun commands in `rerun.md`
