# Stop Conditions

Stop, pause, or ask the user when continuing would make the review unreliable or unsafe.

## Contents

- Scope and Base
- Sensitive Artifacts
- Async External Review
- Verification Blockers
- Repeated Findings
- User Decisions
- Automatic Fix Boundaries
- Hard No

## Scope and Base

Stop when:

- The target diff cannot be identified.
- The base branch or merge base is ambiguous.
- The diff includes unrelated work that cannot be separated confidently.
- The user asks for a PR review but no PR diff or local equivalent is available.
- The diff is too large to review responsibly in one pass.

Ask for the desired scope before continuing.

## Sensitive Artifacts

Stop before reading, quoting, uploading, or sending review content from:

- Path segments exactly named `.env` or `.env.keys`.
- private keys, tokens, certificates, credentials, secret dumps
- auth state, cookies, browser profiles
- local database dumps or customer data extracts
- generated files that embed secrets

If such files appear in the diff, report their paths only and recommend removing them from the review target.

## Async External Review

Do not close out when:

- external review status is `started`.
- boundary helper returns `wait_external_review`.
- expected external review artifacts are missing.
- the adapter reports a nonterminal wait/resume message.

For code-review, run:

```bash
node .agents/skills/code-review/scripts/run-boundary-step.mjs \
  --action check \
  --run-dir "<run-dir>" \
  --repo-root "$(pwd)"
```

If the check returns `wait_external_review`, run:

```bash
node .agents/skills/code-review/scripts/run-boundary-step.mjs \
  --action wait \
  --run-dir "<run-dir>" \
  --repo-root "$(pwd)"
```

If `run-boundary-step --action wait` exits without a terminal state, times out, or returns no usable terminal result, closeout remains blocked.

Before ending a review-backed run, run:

```bash
node .agents/skills/code-review/scripts/run-boundary-step.mjs \
  --action close-if-illegal \
  --run-dir "<run-dir>" \
  --repo-root "$(pwd)"
```

Terminal outcome mapping:

- `clean` maps to a clean final verdict.
- `issues_found` maps to queue items.
- `failed`, `stalled`, or `blocked` map to final verdict `blocked` unless the user chooses otherwise.

Do not close out when the boundary helper requires `inner_receive_review`, `inner_request_review`, `deep_review`, or `wait_external_review`.

## Verification Blockers

Stop or mark `blocked` when:

- Required dependencies are unavailable and no meaningful fallback exists.
- Tests require credentials, services, data, or network access not available in the environment.
- A command fails because of environment setup unrelated to the change.
- The repo has no discoverable verification path and risk is non-trivial.

Report the attempted command, failure summary, and what is needed.

If a command fails because a flag, path, review target, or input is unsupported, do not rerun the same command with the same stderr. Inspect the script or docs, switch to a documented fallback, or stop with `needs_user_decision`.

## Repeated Findings

Stop with `needs_user_decision` when:

- The same finding appears twice without new evidence.
- A reviewer repeats a suggestion already rejected with technical evidence.
- Fixing an item would change product behavior beyond the review scope.
- Findings conflict and cannot be resolved from code/docs.

## User Decisions

Ask only when one of these applies:

- Expanding review scope beyond the requested target.
- Applying broad refactors or cleanup.
- Escalating a fix into `writing-plans` / `executing-plans` because it is broad, architectural, or too complex for a direct fix.
- Changing important UX, product behavior, permissions, data semantics, or public API behavior.
- Rejecting, deferring, or marking a finding as false-positive when the answer is not mechanically provable from code/docs.
- Deleting code where usage is unclear.
- Deferring a critical or security finding.
- `receiving-code-review` is uncertain or asks for clarification.
- All reviews and verification are clean but a real unresolved closeout decision remains.

Do not ask before accepted direct fixes that are in scope, low risk, and locally verifiable.
Respect explicit review-only, findings-only, no-edit, audit-only, or comments-only instructions without asking; report findings only unless the user later authorizes edits.

## Automatic Fix Boundaries

Continue without user intervention when the next fix is accepted, in scope, low risk, and locally verifiable. Stop with `needs_user_decision` when the next step would require product judgment, broad redesign, scope expansion, rejecting reviewer evidence, or repeating the same finding without meaningful progress.

## Hard No

Do not continue silently when:

- Sensitive data may be exposed.
- A relevant adapter exists but was skipped without an explicit reason.
- Review mode changed accidentally.
- Verification is failing but the report would otherwise say clean.
- The fix loop is churning without reducing risk.
- Accepted automatic fixes remain but the run is about to close with `issues_found`.
