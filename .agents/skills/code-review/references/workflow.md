# Review Workflow

Use this workflow after `SKILL.md` triggers. Keep the selected review mode stable for the whole run. Default to an autonomous review/fix/review loop: fix accepted, in-scope findings without asking, and ask only when judgment or product risk requires it. If the user explicitly asks for review-only, findings-only, no edits, audit-only, or comments-only, keep the run read-only and report findings without editing.

## Inputs

Accept `uncommitted`, `branch` / `branch-stack`, `PR <id-or-url>`, or explicit file/directory paths. Treat `branch` as branch-stack mode: review the current branch against a base ref. If target, base branch, or intended scope is ambiguous, stop and ask before reviewing.

Honor explicit no-edit scope. Review-only requests still use available adapters and durable artifacts, but the queue stops at findings, false-positive evidence, blockers, or clean closeout. Do not enter the automatic fix loop unless the user later authorizes edits.

## Preflight

1. Read repo instructions first: `AGENTS.md`, `CLAUDE.md`, README, nearby docs, and package or CI files relevant to the target.
2. Identify target, base, branch, changed files, and diff stat.
3. Inspect working tree status and separate unrelated local edits from the requested review.
4. Refuse to review or transmit sensitive local artifacts: path segments exactly named `.env` or `.env.keys`, secret/key files, auth state, browser profiles, local credentials, generated tokens, private dumps.
5. Discover available adapters from `references/adapters.md`.
6. For large diffs, summarize scope and ask whether to review all changes or a narrower slice.

Useful generic evidence commands:

```bash
git branch --show-current
git status --short
git diff --stat
git diff --name-only
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD origin/master 2>/dev/null
```

## Review

Run relevant rubric passes and merge findings:

- correctness, regression, security, privacy, auth, data integrity, API contract, performance, maintainability, tests, UI/framework, AI-slop
- early local checks from package scripts or CI config; optional Core8 helper: run `yarn cq` early and queue failures as top priority

Read `references/adapters.md` before non-manual passes. In repositories with bundled code-review helpers, External Codex must use `run-external-review-round.mjs`.

Async adapters must reach a terminal state before final verdict. For the bundled External Codex adapter, use `run-boundary-step.mjs --action wait` when required, `--action check` after `issues_found`, and `--action close-if-illegal` before final closeout.

When External Codex returns `issues_found`, use `receiving-code-review` before editing when available. If it is unavailable, use the same posture manually: verify each claim against code, reject false positives with evidence, and only fix accepted findings.

After triage, do not ask before routine fixes. Automatically fix findings that are all of:

- accepted by `receiving-code-review` or validated manually with evidence
- within the requested target or directly necessary to preserve the changed contract
- low product/UX risk
- implementable as a direct code or test change without broad refactor
- not a repeated unchanged finding
- not blocked by an explicit review-only or no-edit user instruction

After accepted fixes, run local verification, run inner review, then rerun External Codex with the same persisted mode. Keep looping until the latest External Codex round is terminal `clean`, the run is `blocked`, or a stop condition requires `needs_user_decision`.

When the first External Codex round is clean, run one deep review pass. Deep-review findings reopen the same queue and require the same autonomous triage/fix/verify/inner-review/rerun loop.

For AI-slop cleanup, run a bounded loop: review, fix safe simplifications, verify, reviewer-only rerun. Stop after 3 iterations, clean reviewer pass, blocker, or repeated issue.

## Queue

Use `references/review-queue-format.md`. De-duplicate by root cause, keep only actionable findings, and prioritize security/correctness, bugs, data integrity, API contract, performance, tests, maintainability, then style.

Report:

```text
TLDR: total=<N> | critical=<N> | bug=<N> | perf=<N> | maintainability=<N> | tests=<N> | blocked=<N> | sources=<core:ran|skipped:<reason>|N/A, external-codex:ran|skipped:<reason>|N/A, simplify:ran|skipped:<reason>|N/A, ui:ran|skipped:<reason>|N/A, react-next:ran|skipped:<reason>|N/A, security:ran|skipped:<reason>|N/A, data:ran|skipped:<reason>|N/A, ai-slop:ran|skipped:<reason>|N/A, ci:pass|fail|skipped:<reason>|N/A>
```

Every applicable conditional adapter must appear in `sources` as `ran` or `skipped:<reason>`. Use `N/A` only when the touched files make that adapter irrelevant. Missing source accounting blocks a `clean` closeout.

## Autonomous Fix Loop

Handle queue items without user intervention when they satisfy the automatic-fix criteria above:

1. Restate the issue internally with exact evidence.
2. Choose the smallest direct fix and acceptance criteria.
3. Edit only scoped files for accepted fixes.
4. Run the smallest relevant verification.
5. Record/update queue status.
6. Run inner review before the next External Codex round.

Do not auto-fix when:

- `receiving-code-review` is uncertain or cannot validate the finding
- the user explicitly requested review-only, findings-only, no edits, audit-only, or comments-only; report findings only unless the user later authorizes edits
- accepting the fix would change important UX, product behavior, permissions, data semantics, or public API behavior
- the finding appears false-positive or should be rejected/deferred
- the fix requires broad refactor, architectural redesign, or scope expansion
- findings repeat without meaningful progress
- final closeout still has a real unresolved decision

Ask the user for the uncertain, product-impacting, false-positive/defer, broad-work, repeated-finding, or unresolved-closeout cases above.

Use direct fixes by default. Escalate to `writing-plans` and `executing-plans` only after asking when the accepted fix is genuinely complex, broad, or architectural.

## Verification

Before saying code is ready or clean, run fresh checks and report exact commands. Choose from package scripts, CI config, targeted tests, lint, typecheck, build, browser checks, screenshots, or migration checks. Optional Core8 helper: code changes require `yarn cq` unless clearly impossible.

## Closeout

Return `clean`, `issues_found`, `blocked`, or `needs_user_decision`. Do not return `issues_found` as a terminal state when accepted automatic fixes remain; continue the loop. Use `needs_user_decision` for uncertain triage, product/UX-impacting changes, false-positive/defer choices, broad work, or repeated findings. When all required review and verification is clean, all applicable adapters are accounted for, and no source is blocked, record completed closeout and return `clean`, not `needs_user_decision`.

Include target/files reviewed, angles and sources run/skipped, findings summary, unresolved queue, fixes made, verification commands/results, and residual risks.
