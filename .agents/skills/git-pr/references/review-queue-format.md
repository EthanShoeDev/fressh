# Review Queue Format

Create a single consolidated queue of findings. Each item must be actionable and scoped.

## Queue item fields

- **Severity**: `Critical` | `Bug` | `Perf` | `Maintainability` | `Style` | `Needs clarification`
- **Title**: short, specific
- **Location**: best-effort pointer (`path:line` or component/function)
- **Evidence**: what you observed (link to diff hunk, error output, or code snippet summary)
- **Recommendation**: concrete change to make
- **Acceptance criteria**: how we know it’s done (what should be true after the fix)
- **Verification**: smallest command/check to run after the fix
- **Decision**: `Fix` | `Skip` | `Defer` (set only after user decides)
- **Status**: `Open` | `In progress` | `Done`

## Example item

```text
Severity: Bug
Title: Handle null orgId in route param
Location: src/app/(dashboard)/org/[orgId]/page.tsx:42
Evidence: page throws when orgId missing; stack trace in yarn dev
Recommendation: Validate orgId and render notFound() or redirect
Acceptance criteria: Missing orgId no longer throws; correct behavior confirmed
Verification: yarn cq && yarn test:frontend
Decision: Fix
Status: Done
```

