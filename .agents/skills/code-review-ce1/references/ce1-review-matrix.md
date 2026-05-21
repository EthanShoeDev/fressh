# CE1 Review Matrix

Use this matrix after the stable workflow has established the review target, diff scope, risk areas, and existing findings.

## Reviewer Routing

The reviewer names below are Codex `agent_type` values from the Compound Engineering agent installation. Invoke them by exact `agent_type` name when they are available in the current Codex session. If a listed reviewer is unavailable, skip it and record `skipped:not-available-in-environment`.

- Always consider `ce-correctness-reviewer` for code changes.
- Add `ce-maintainability-reviewer` when the diff changes structure, ownership boundaries, abstractions, naming patterns, or module responsibilities.
- Add `ce-testing-reviewer` when coverage, regression risk, test design, or verification confidence is material to the review.
- Add specialist reviewers only when the changed diff clearly matches their domain.

Specialist examples:

- Use `ce-security-reviewer` for auth, permissions, public endpoints, secret handling, or user input security risks.
- Use `ce-api-contract-reviewer` for request or response contracts, exported types, serialization, versioning, or public API behavior.
- Use `ce-data-migrations-reviewer` or `ce-data-integrity-guardian` for migrations, schema changes, backfills, persistent data shape, or data privacy risk.
- Use `ce-performance-reviewer` for database queries, caching, loop-heavy transforms, I/O-heavy paths, or scaling risk.
- Use `ce-reliability-reviewer` for retries, timeouts, circuit breakers, error propagation, background jobs, or async failure modes.
- Use frontend specialist reviewers only when the diff touches UI lifecycle, async frontend behavior, or user-facing interaction risk.

Do not run a large reviewer panel for tiny changes. Prefer one to three CE reviewers unless the diff clearly spans more domains.

## Reporting Rules

- If a CE reviewer finds a new valid issue, record it under `Findings added by CE1`.
- If a CE reviewer duplicates an existing finding, record it as confirmed by CE1.
- If a CE reviewer cannot run cleanly, record it under `Reviewers skipped` with the failure reason.
- If CE1 finds no material issues, report that directly.
- If a reviewer was considered and skipped, explain the reason in one short phrase.

## Contribution Block Shape

Use this shape in the final report:

```md
CE1 contribution:
- Reviewers run: list exact CE reviewers that ran
- Reviewers skipped: list considered reviewers and short reasons
- Findings added by CE1: list new valid findings or say "none"
- Findings confirmed by CE1: list duplicated findings that increased confidence or say "none"
- Net effect: caught issue / confirmed risk / no material contribution
```
