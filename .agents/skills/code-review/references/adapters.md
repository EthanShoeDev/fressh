# Review Adapters

Use adapters when they exist in the current repository. Adapters add evidence sources to the same consolidated queue; the parent agent owns the lifecycle and must continue the autonomous review/fix/review loop until clean, blocked, or user decision.

## Contents

- Adapter Discovery
- External Codex / code-review Adapter
- Durable Event Recording
- Deep Review
- Durable Artifacts
- Review Profiles
- Simplify Adapter
- ai-slop-cleaner Adapter
- PR CI And Review Comment Adapter
- UI Screenshot Evidence
- Early Local Checks
- Conditional Skill Adapters
- Generated Review Reports

## Adapter Discovery

Check for these paths before reviewing:

- `.agents/skills/code-review/scripts/run-external-review-round.mjs`
- `.agents/skills/code-review/scripts/run-artifacts.mjs`
- `.agents/skills/code-review/scripts/run-boundary-step.mjs`
- `.agents/skills/ai-slop-cleaner/SKILL.md`
- `.agents/skills/simplify/SKILL.md`
- `.agents/skills/web-design-guidelines/SKILL.md`
- `.agents/skills/vercel-react-best-practices/SKILL.md`
- repository PR/CI scripts such as `scripts/pr-watch.mjs` and `scripts/review-comments.mjs`

If an adapter is present and relevant, run it or explicitly report why it was skipped.

## Adapter Accounting

Before closeout, build a source ledger for every review source:

- `core`: always applicable; record `ran` or `skipped:<reason>`.
- `external-codex`: applicable when bundled helpers exist and the target is compatible; record `ran` or `skipped:<reason>`.
- `simplify`: applicable when changed code is recent, generated-looking, cleanup was requested, or the diff contains maintainability churn; record `ran`, `skipped:adapter-missing`, `skipped:review-only-no-readonly-mode`, `skipped:target-incompatible`, or `N/A`.
- `ui`: applicable when touched files include UI components, styles, Storybook, browser routes, screenshots, or interaction behavior; run `web-design-guidelines` or record `skipped:<reason>`.
- `react-next`: applicable when touched files include React components, hooks, Next.js routes/layouts/pages, client/server boundaries, or frontend data fetching; run `vercel-react-best-practices` or record `skipped:<reason>`.
- `security`: applicable when touched files include auth, authorization, permissions, tenancy, public endpoints, secrets, redirects, uploads/downloads, or user-input handling; run an available security adapter/manual pass or record `skipped:<reason>`.
- `data`: applicable when touched files include migrations, Prisma schema, persistence, backfills, writes, transactions, or reporting facts; run an available data-integrity adapter/manual pass or record `skipped:<reason>`.
- `ai-slop`: applicable when the diff shows generated-code smells or cleanup was requested; record `ran`, `skipped:<reason>`, or `N/A`.
- `ci`: record `pass`, `fail`, `skipped:<reason>`, or `N/A`.

Allowed skip reasons include `adapter-missing`, `target-incompatible`, `review-only-no-readonly-mode`, `scope-ambiguous`, `blocked`, and `not-available-in-environment`. Keep the reason short and specific. Do not use `N/A` for an applicable adapter.

Missing source ledger entries are workflow blockers. Do not report `clean` until every applicable adapter is either `ran` or `skipped:<reason>`.

## Closeout Review Helper

For routine round-1 closeout reviews, prefer the convenience helper:

```bash
node .agents/skills/code-review/scripts/run-closeout-review.mjs
```

It keeps the standard review workflow intact. The helper resolves the common target, initializes durable artifacts, starts the existing External Codex adapter with the `mix` profile, and prints the wait command when the review remains asynchronous.
Use the no-flag form only after preflight confirms the dirty worktree/current branch is the intended target. The helper prioritizes dirty worktree state and returns an uncommitted review before considering `--base`; `--base` does not force branch-stack review when dirty edits are present. For branch-stack review with dirty or unrelated local edits, first clear or stash those edits, or use the lower-level explicit branch-stack commands after scope is clear.

Supported options are intentionally narrow:

```bash
node .agents/skills/code-review/scripts/run-closeout-review.mjs --check "bun test"
node .agents/skills/code-review/scripts/run-closeout-review.mjs --base origin/main
node .agents/skills/code-review/scripts/run-closeout-review.mjs --id my-review
node .agents/skills/code-review/scripts/run-closeout-review.mjs --dry-run
```

Use the lower-level `run-artifacts.mjs`, `run-external-review-round.mjs`, and `run-boundary-step.mjs` commands when resuming a run, selecting a later round, changing profiles, or handling non-routine lifecycle states.

## External Codex / code-review Adapter

When all bundled code-review helpers exist, use them for the external Codex review pass instead of a hand-rolled external review.

Required helpers:

```bash
test -f .agents/skills/code-review/scripts/run-artifacts.mjs
test -f .agents/skills/code-review/scripts/run-external-review-round.mjs
test -f .agents/skills/code-review/scripts/run-boundary-step.mjs
```

Choose and persist one mode:

- `uncommitted` for working-tree review.
- `branch-stack` for current branch against a base ref.

Initialize durable artifacts for an uncommitted working-tree review:

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs init \
  --review-id "<review-id>" \
  --review-mode uncommitted \
  --review-target=--uncommitted
```

Initialize durable artifacts for a branch-stack review:

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs init \
  --review-id "<review-id>" \
  --review-mode branch-stack \
  --base-ref "<base-ref>" \
  --review-target="--base <base-ref>"
```

Use the generated run directory under:

```text
docs/tool-output/code-review/<review-id>
```

Run the external review for an uncommitted working-tree review:

```bash
node .agents/skills/code-review/scripts/run-external-review-round.mjs \
  --repo-root "$(pwd)" \
  --run-dir "docs/tool-output/code-review/<review-id>" \
  --round 1 \
  --review-id "<review-id>" \
  --review-mode uncommitted \
  --review-target=--uncommitted \
  --review-profile mix
```

Run the external review for a branch-stack review:

```bash
node .agents/skills/code-review/scripts/run-external-review-round.mjs \
  --repo-root "$(pwd)" \
  --run-dir "docs/tool-output/code-review/<review-id>" \
  --round 1 \
  --review-id "<review-id>" \
  --review-mode branch-stack \
  --base-ref "<base-ref>" \
  --review-target="--base <base-ref>" \
  --review-profile mix
```

If the wrapper returns or records `started`, do not close out. Wait for the same round:

```bash
node .agents/skills/code-review/scripts/run-boundary-step.mjs \
  --action wait \
  --run-dir "docs/tool-output/code-review/<review-id>" \
  --repo-root "$(pwd)"
```

If the boundary helper says `wait_external_review`, the only legal next action is the wait command above.

After terminal external review:

- `clean`: if this is the first clean External Codex round for the current fix cycle, run one deep review pass before closeout.
- `issues_found`: validate findings with `receiving-code-review` before fixing when that skill exists; otherwise use the same posture manually: verify each claim against code, reject false positives with evidence, and merge accepted findings into the queue. Automatically fix accepted, in-scope, low-risk findings unless the user explicitly requested review-only/no-edit mode; respect explicit no-edit scope, and ask only for uncertainty, UX/product behavior changes, suspected false positives, broad work, repeated findings, or blockers.
- `blocked`, `failed`, or `stalled`: mark the adapter item blocked and include artifact paths.

After external-review-sourced fixes, run local verification, run an inner review, and then rerun External Codex with the same persisted mode. Do not close out from local verification alone, and do not stop at `issues_found` when automatic fixes remain.

Never replace this adapter with a manual `git diff` self-review when the bundled helpers are available and the target is compatible.

## Durable Event Recording

When review artifacts are active, record meaningful lifecycle steps through `run-artifacts.mjs record` instead of leaving them only in chat:

- `main_agent_triage` after classifying external findings into fix, defer, separate issue, or false positive.
- `main_agent_fix` after applying accepted fixes.
- `main_agent_verify` after local verification.
- `inner_receive_review` when receiving or validating external-review findings.
- `inner_execute` after any inner-loop code change, including direct-fix execution inside an inner cycle, with at least one `fix-now` item.
- `inner_request_review` after inner review returns clean or reports counts.
- `deep_review` after the deep review pass.
- `final_summary` before terminal closeout.

Use `references/record-templates.md` when present for exact command shape. Regenerate the tracked report after meaningful terminal states.

Review event invariants:

- Every `main_agent_fix` must be followed by a same-round `main_agent_verify` before the next External Codex round, deep review, user decision, or final closeout.
- Every inner-loop code change must record `inner_execute` with at least one `fix-now` item.
- Inner review is clean only when recorded as `clean` or as `completed` with `0 critical / 0 important / 0 minor`.
- Do not record `final_summary completed` before the latest External Codex round reaches terminal `clean` and required deep review is complete.
- Use `final_summary needs_user_decision`, `stopped`, or `blocked` for non-terminal handoff states. Treat only `final_summary completed` as terminal clean closeout.
- Do not record `final_summary issues_found` or end the run while accepted automatic fixes remain.

## Deep Review

After the first clean External Codex round, run one deep review pass before final closeout. Use the repository's available deep-review mechanism when one exists; otherwise run a manual deep pass focused on cross-file regressions, integration boundaries, missed tests, and hidden behavior changes.

If deep review finds issues:

- merge findings into the queue
- automatically fix accepted, in-scope, low-risk findings
- run local verification
- run inner review
- rerun External Codex with the same persisted mode

Only close out after the latest External Codex round is clean after any deep-review fixes.

## Durable Artifacts

When review artifacts are active, preserve these links in the closeout:

- `docs/tool-output/code-review/<review-id>/events.jsonl`
- latest `docs/tool-output/code-review/<review-id>/rounds/<n>/codex-review.md`
- generated `docs/run/code-review-<review-id>.md`

Do not hand-edit generated reports. Regenerate through `run-artifacts.mjs summarize`:

```bash
node .agents/skills/code-review/scripts/run-artifacts.mjs summarize \
  --run-dir "docs/tool-output/code-review/<review-id>"
```

## Review Profiles

When review profiles exist, choose at least one:

- `mix`: default broad merge-risk review.
- `correctness`: runtime bug hunting.
- `architect`: shared contracts, layering, blast radius.
- `roasted`: harsh simplicity and breakage review.
- `default`: balanced fallback.

For high-risk diffs, run `mix` first and then one targeted profile. Merge all findings into the same queue.

## Simplify Adapter

When `.agents/skills/simplify/SKILL.md` exists and the target includes recently changed code, run it as a review/refinement source before final queue consolidation when behavior can be preserved. Treat any simplification changes like other fixes: verify locally, record them when review artifacts are active, and rerun required external review before clean closeout.

## ai-slop-cleaner Adapter

When `.agents/skills/ai-slop-cleaner/SKILL.md` exists and the diff shows AI-slop signals or the user asks for cleanup, run that workflow as the AI-slop review source.

If the target is a PR, carry PR context into every ai-slop-cleaner pass:

- PR id or URL
- PR title and summary when available
- changed files
- current branch or diff target
- user constraints from the request

Use review-only mode when reviewing:

```text
Use ai-slop-cleaner --review on <target> with <PR/context payload>. Return findings only; do not edit files.
Return exactly one JSON object on the last line:
{
  "status": "clean",
  "issues": [],
  "changed_files": [],
  "verification": [],
  "confidence": 0.9
}
```

Allowed statuses are `clean`, `issues_found`, and `blocked`. Each issue must include `id`, `severity`, `summary`, and `fix`.

If the user accepts cleanup fixes, run bounded cleanup:

- maximum 3 iterations
- preserve behavior
- verify after each pass
- after any cleanup change, run one reviewer-only pass before declaring clean
- if the JSON result is missing or malformed, retry once with a JSON-only reminder
- if the retry still misses the JSON contract, stop as `blocked`
- do not infer status, issue IDs, or confidence from prose when JSON is missing or malformed
- if the same issue IDs repeat twice in a row, stop with `needs_user_decision`

## PR CI And Review Comment Adapter

When target is a PR and repository tooling exists, include existing CI and review feedback as review sources.

Optional Core8 PR helper commands:

```bash
node scripts/pr-watch.mjs --pr <pr_number_or_url> --watch --interval 60 --max-interval 60 --timeout 120
node scripts/review-comments.mjs list --pr <pr_number_or_url> --json
gh pr view <pr_number_or_url> --json comments,reviewDecision,reviews
```

For other repositories, use equivalent platform tools when available. Convert actionable CI failures and review comments into queue items. Do not resolve or reply to review threads unless the user separately asks.

## UI Screenshot Evidence

For UI changes, capture before/after screenshots or follow the repository screenshot checklist when one exists. Optional Core8 helper: use `git-pr/references/screenshots-checklist.md` when available. Include screenshot paths or browser evidence in the review queue or closeout.

## Early Local Checks

Run repo-local static checks early enough to feed the review queue, not only at final closeout. Optional Core8 helper: `yarn cq` failures are top-priority queue items. For other repositories, infer the closest early check from package scripts, CI config, Makefiles, or task runners.

## Conditional Skill Adapters

If these skills exist and the target matches, use them as review sources:

- UI files: `.agents/skills/web-design-guidelines/SKILL.md`
- React/Next files: `.agents/skills/vercel-react-best-practices/SKILL.md`
- Security-sensitive files: available security review skill or local security docs
- Database/migration files: available data integrity review skill or local migration docs

If a conditional adapter is relevant but absent, perform the rubric pass manually when possible and record `skipped:adapter-missing` for that adapter. If the target is incompatible with the adapter, record `skipped:target-incompatible`. If the user requested review-only/no-edit and the adapter cannot run without editing, record `skipped:review-only-no-readonly-mode`.

## Generated Review Reports

Treat `docs/run/code-review-*.md` as generated review context, not normal source findings. Review the latest current report for context, preserve it as an artifact link when relevant, and avoid queue noise that only says to include or exclude generated review reports.
