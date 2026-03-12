# Stop Conditions (Preflight + Shipping)

Stop and ask the user what to do next when any of these are true.

## Preflight stop conditions

- Branch appears to be based on the wrong base branch (e.g., includes unrelated commits vs `origin/dev`).
- Working tree contains unexpected files (secrets, dumps, generated artifacts, large binaries).
- The diff is unexpectedly large or spans multiple unrelated areas (risk of “drive-by refactor”).
- You cannot determine the review target (unstaged vs staged vs branch diff vs PR diff).

## Shipping stop conditions

- Verification gate did not pass (`yarn cq` or required tests failing).
- Migration/schema changes without clear rollout plan or reviewer context (including Prisma/migrations conflicts).
- CI is expected to be required but cannot be run locally and no evidence is available.
- The user has not explicitly approved push/PR/issue actions.

## Safe options to offer

- Rebase/merge base branch and re-run review.
- Split the work into smaller PRs (scoped by feature/area).
- Continue in `review-only` mode (no shipping).
- Proceed anyway (only after explicit user approval and documenting risk).
