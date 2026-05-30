---
name: feature-interview
description: Use when explicitly requested as $feature-interview or named directly for legacy feature discovery compatibility.
metadata:
  short-description: Feature discovery interview
version: 0.1.0
---

# Feature Interview (Compatibility Variant)

This skill is kept for compatibility only.

Required first step:

- Open and follow `.agents/skills/brainstorming/SKILL.md`.

Canonical owner:

- `.agents/skills/brainstorming/SKILL.md`

## Variant Behavior

- Use a deeper discovery style for new feature work
- Probe hidden assumptions, edge cases, and scope boundaries
- Produce the same requirements-style output contract as `brainstorming`
- Preserve the old optional publish/share behavior by posting the resulting requirements artifact to GitHub when the user explicitly asks for it
- After requirements stabilize:
  - route to `write-design-doc` if the feature needs a system contract
  - otherwise route to `plan-interview`

## Interview Expectations

Bias the conversation toward:

- user-visible behavior,
- edge cases and failure states,
- explicit non-goals,
- dependencies and rollout constraints,
- the simplest version that still delivers value.

## Rules

- `feature-interview` is not a separate planning workflow.
- Do not write `.claude/plans/...`.
- Do not create an implementation plan here.
- Do not keep an independent post-interview lifecycle.
- If the user wants the requirements shared on GitHub, publish the canonical brainstorm artifact rather than reviving a separate legacy plan format.
- If an issue number is provided, comment with the brainstorm artifact:
  - `./bin/core8 git issue comment <issue-number> --body-file <brainstorm-artifact-path>`
- If there is no issue number and the user wants a new issue, create one from the brainstorm artifact:
  - `./bin/core8 git issue create --title "<requirements heading>" --body-file <brainstorm-artifact-path>`
- After discovery, defer to `brainstorming` ownership and handoff rules.
