---
name: git-pr
description: "Interactive PR finalization workflow for Cube9/Core8. Use when you need to prepare a branch/PR for merge: gather git/gh context, run multi-pass review (reuse simplify/code-review + optional UI/React guideline checks), consolidate findings into one queue, walk the user one item at a time (fix/skip/defer), run verification gates (yarn cq + relevant tests), then optionally ship (commit/push/create or update PR + issue updates) only after explicit user approval."
---

# Git PR

## Goal

Turn an in-progress branch into a review-ready PR via a strict, user-in-the-loop loop:
review → queue → fix/skip/defer → verify → (optional) ship.

## Non-negotiables

1. Evidence before claims: do not say “tested/passing/fixed” without fresh command output.
2. Shipping is opt-in: do not push, create/update PRs, or mutate issues without explicit user approval.
3. One item at a time: handle findings as explain → recommend → user chooses Fix/Skip/Defer.
4. Branch naming is automatic: do not ask the user to invent a branch name.
5. Relevant design docs are included by default: do not ask whether to include/exclude docs unless the user explicitly asks for code-only.
6. Shipping commits/PR updates must use bot credentials (`core8-claude-code[bot]` / `app/core8-claude-code`) and signed GitHub API commit flow; do not push local-user commits.
7. Prefer `bash scripts/with-bot-env.sh yarn zx scripts/bug-fix-pr.mjs ... --auto-stage --no-confirm` for shipping so tracked and untracked files are included in one signed bot commit.
   - This automated path must also keep local `docs/run/rloop-code-fix-*.md` files out of the final PR diff, post them to the PR as comment(s), and delete the local copies after successful posting.
   - If one of those files was already tracked earlier on the branch, the ship flow may stage a cleanup removal so the final PR diff no longer contains it, while still preserving a local copy long enough to post it as PR context.
8. If local commits exist ahead of remote, do not push them directly; re-stage changes and re-ship through signed bot flow.

## Inputs to collect

Mode flags:

- `review-only`: run review/fix/verification only, then stop (no shipping step).
- `include-ship`: run full flow including shipping options after verification.
- Default mode is `include-ship` unless the user explicitly requests `review-only`.

If not provided by the user, ask for:

- Issue number/link (if any).
- PR number/link (if any).
- Mode only when ambiguous.

If there is no issue and the work should be tracked, offer to create one **only after explicit user approval**.

Branch naming policy:

- Do not ask for a branch name.
- Build branch name from issue id + issue title using slugification:
  - format: `fix/<issueNumber>-<slug>`
  - slug rules: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, limit to ~48 chars.
- If the current branch is `dev`/`main`/`master`, create and switch to the computed branch once issue id/title are known.
- If the computed branch already exists locally/remotely, append `-v2`, `-v3`, etc.

## Workflow

### 1) Preflight (always)

0. Check if `~/todo.md` exists. If it does and contains open items, remind the user: "There are open TODO items in `~/todo.md` — consider reviewing them (`/todo-review`) before or after shipping this PR."
1. Confirm current branch name and intended base branch (commonly `origin/dev` in this repo).
2. Inspect working tree (`git status`) and confirm what should be included/excluded.
   - Special case: if `docs/run/rloop-code-fix-*.md` files are present, treat them as generated PR-context artifacts. Review them locally, but do not queue them as normal “exclude this file” findings. Only the latest current run report should be posted to the PR; older stale leftovers should stay local and must not be attached to the current PR or deleted as part of the current ship.
3. Identify the review target: unstaged changes, staged changes, branch diff, or PR diff.
4. Check whether `/review` has already been run for the current changes; if not, remind the user to run `/review` before continuing review passes.
5. Resolve PR context metadata with `node scripts/todo-resolve-pr-context.mjs --issue <issue-number> --cwd "$(pwd)" --json` and keep session id + function label for the PR description.
6. Resolve issue context early (existing issue number, or create issue with explicit approval if needed).
7. Decide whether evidence-in-issue posting is relevant (typically bug fixes or behavior verification). If relevant and no evidence comment has been posted yet in this session, remind the user to post/update the issue (or related data issue) with proof that the bug is fixed/feature works, including screenshots when applicable.
8. If on `dev`/`main`/`master`, auto-create/switch to `fix/<issue>-<slug>` (do not ask for branch name).
9. If the base is wrong or the diff includes unrelated commits, STOP and follow `references/stop-conditions.md`.
10. Confirm bot shipping credentials are available before ship by running `bash scripts/check-bot-env.sh` (supports `GH_TOKEN_CLAUDE_CODE` or GitHub App credentials from `~/.env`).

Evidence commands (capture output for later PR/issue artifacts):

```bash
git branch --show-current
git status
git remote -v
git log --oneline -10
git diff --stat
node scripts/todo-resolve-pr-context.mjs --issue <issue-number> --cwd "$(pwd)" --json
bash scripts/check-bot-env.sh
```

### 2) Review passes (choose based on touched areas)

Run the minimum set needed and merge results into one queue:

- **Simplify**: invoke `$simplify` to improve clarity without changing behavior.
- **Core code review**: invoke `$code-review` to review the diff/PR against repo standards.
- **UI review (conditional)**: if UI is touched, invoke `$web-design-guidelines`.
- **React/Next review (conditional)**: if React/Next code is touched, invoke `$vercel-react-best-practices`.
- **Local checks (always)**: run `yarn cq` early; any failures become top-priority queue items.

Local checks (evidence):

```bash
yarn cq
```

### 3) Consolidate into a single queue

Create a single prioritized queue using `references/review-queue-format.md`.

Rules:

- De-duplicate similar findings across sources.
- Prioritize: correctness/security → bugs → perf → maintainability → style.
- If a finding is ambiguous, add it as “Needs clarification” and ask before changing code.
- Do not add queue items that ask whether to include/exclude relevant `docs/design/*` files; include them by default.

Required one-line TLDR after consolidation (for readability and quick status):

- Format:
  - `TLDR: total=<N|0> | simplify=<ran:<n>|0|N/A> | code-review=<ran:<n>|0|N/A> | ui=<ran:<n>|0|N/A> | react-next=<ran:<n>|0|N/A> | yarn-cq=<pass|fail:<n>|N/A>`
- Rules:
  - `<N>` is total queue size after de-duplication.
  - Use `0` when the value is zero findings.
  - Use `N/A` when that check was not run / not applicable.
  - Keep it to exactly one line.

### 4) Interactive fix loop (one item at a time)

For each queue item:

1. Analyze: point to the exact code and restate the issue.
2. Explain: why it matters (impact/risk).
3. Recommend: concrete fix + acceptance criteria.
4. Ask the user: Fix / Skip / Defer / Clarify.
5. If Fix: implement; run the smallest meaningful check; update item status. Avoid pushing local commits during the loop. Final shipping commit should be created by the signed bot flow.

Do not move to the next item until a decision is made.

### 5) Verification gate (required)

Before saying “ready” or offering shipping:

- Run `yarn cq`.
- Run the smallest relevant test suite (often `yarn test:ci:tests` or `yarn test:ci`; justify if skipped).
- If verification fails: add failures to the queue and return to the fix loop.

### 6) Ship (optional; explicit approval required)

Only run this step when mode is `include-ship`.

Offer exactly these options and wait for user approval:

1. Ship automated signed (recommended): `bash scripts/with-bot-env.sh yarn zx scripts/bug-fix-pr.mjs <issue> \"<summary>\" --auto-stage --no-confirm` (add `--skip-tests` only when already verified in Step 5).
   - If local `docs/run/rloop-code-fix-*.md` files exist, this path should exclude the latest current run report from the commit automatically and post it to the PR as generated comment(s) once the PR exists. If the branch still contains older tracked report files from an earlier iteration, ship should create a signed cleanup commit to remove them from the PR diff before falling back to any report-only rerun path.
2. Ship manual signed (advanced): use `bash scripts/with-bot-env.sh node scripts/github-api-commit.mjs ...` + bot token flow; do not use local-user `git push`.
   - If local `docs/run/rloop-code-fix-*.md` files exist, prepare the PR comment body from the latest current run report first, keep it out of the commit, post it to the PR after creation/update, then delete that local generated copy. Do not sweep older stale report files into the current PR comment set.
3. Stop after review (user ships).
4. Discard/rollback (requires explicit typed confirmation, e.g. `DISCARD`).

Do not perform shipping actions unless the user explicitly selects an option that ships.

### 7) Post-ship hygiene (if a PR exists)

- Update PR description using `references/pr-description-template.md`.
- If `docs/run/rloop-code-fix-*.md` files were present before ship, verify they were posted to the PR as generated comment(s), not committed into the diff.
- Include the current Codex session id and function label in the PR description so future review iterations can resume context and environment.
- Post/update the original issue with `references/issue-update-template.md` before declaring the task done, but only once per `git-pr` run unless there is a material state change (new failing evidence, new fix commit after feedback, or explicit user request).
- Include concrete evidence in the issue comment: commands run, pass/fail status, and verification steps.
- After the PR link/comment is posted, run `./bin/core8 git issue done <issue-number>` to relabel the issue as active PR work (`-Picked`, `-F*`, `+PR`).
- Verify the issue remains open after relabeling.
- If a separate data issue tracks validation evidence, post/update that issue too; if already done in this session, avoid duplicate reminders/comments.
- Do not auto-close the issue from this flow; leave closure to QA/user confirmation unless explicitly requested.
- Prefer `./bin/core8 git issue comment ... --body-file ...` when posting issue updates so local screenshots can be auto-uploaded (if available in the environment).
- If UI changes: use `references/screenshots-checklist.md` to ensure evidence is captured.
- Verify branch-protection identity gates after shipping:
  - PR commits are verified signatures.
  - Latest push actor is bot identity (not local user).

### 8) Optional post-PR follow-up (CI + review comments)

Offer this as an optional step after PR creation/update, and ask explicitly:

- `Do you want me to wait for CI and check review comments now? (yes/no)`
- If user says no, stop after post-ship hygiene.

If user says yes:

- Wait for CI completion and report result (prefer `scripts/pr-watch.mjs` for efficient polling/output).
- Check inline review threads, top-level PR conversation comments, and review submissions; capture any actionable items.

Run:

```bash
# Preferred CI watcher (state-change driven, less noisy)
node scripts/pr-watch.mjs --pr <pr_number_or_url> --watch --interval 60 --max-interval 60 --timeout 120

# After CI watch completes, inspect inline review threads
node scripts/review-comments.mjs list --pr <pr_number_or_url> --json
gh pr view <pr_number_or_url> --json comments,reviewDecision,reviews --jq '{comments:[.comments[] | {author:.author.login,createdAt,body,url}],reviewDecision,reviews:[.reviews[] | {author:.author.login,state,submittedAt,body}]}'
```

Handling rules:

- Scope note: this section applies only when a PR already has CI/review feedback. For a newly created PR with no review comments yet, skip the decline/resolve comment flow.
- If CI failed, convert failures into queue items and return to Step 4 (interactive fix loop).
- If inline review threads or top-level PR comments require changes, convert them into queue items and return to Step 4.
- If a review comment is intentionally **not** implemented in this PR:
  - Post a short rationale comment using `references/pr-review-comment-decline-template.md`.
  - Use `node scripts/review-comments.mjs reply --thread <thread-id> --body-file <path> --resolve` after the rationale is drafted.
  - If the idea should be revisited later, include a follow-up issue link in the comment.
- If CI passes and no actionable inline review threads or top-level PR comments remain, report “ready/mergeable”.
- Do not post another issue status comment in this step if the issue was already updated earlier in the same `git-pr` run and there is no material change.
- Keep waiting output token-efficient:
  - Prefer `scripts/pr-watch.mjs` and report only status transitions/final outcome.
  - Use a 60s polling interval and keep timeout at/above one hour.
  - Do not stream repeated unchanged status lines to the user.

Fix-subflow trigger:

- If any actionable CI failure or review comment is found, initiate a dedicated fix flow immediately.
- Preferred implementation path: use `/git-fix-review-comment` (see `../../../../.codex/prompts/git-fix-review-comment.md`) for each actionable review point.
- Execute one issue/comment at a time: triage → plan → explicit user confirmation → implement → targeted tests.
- After each fix is merged/pushed, return to this optional follow-up step and re-check CI/reviews until clean.
- If `/git-fix-review-comment` is unavailable, follow its equivalent phases manually (ground in PR diff, propose plan, confirm, implement, verify).

## References

- `references/review-queue-format.md`
- `references/stop-conditions.md`
- `references/pr-description-template.md`
- `references/pr-review-comment-decline-template.md`
- `references/issue-update-template.md`
- `references/screenshots-checklist.md`
- `references/skill-pr-review-rubric.md`
- `../../../../.codex/prompts/git-fix-review-comment.md`
