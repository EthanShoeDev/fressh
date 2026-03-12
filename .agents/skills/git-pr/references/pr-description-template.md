# PR Description Template

Use this as the PR body. Keep it crisp and verifiable.

## Summary

- What this PR changes (1–3 bullets)
- Why it’s needed (1 bullet)

## Details

- Key implementation notes (only what reviewers need)
- Tradeoffs / follow-ups (if any)

## How tested

- `yarn cq`
- Tests run (exact command + result)

## How to verify (manual)

1. Steps a reviewer/QA can follow
2. Expected results

## Codex Session

- Session ID: <id from `node scripts/todo-resolve-pr-context.mjs --issue <issue-number> --cwd "$(pwd)" --json`>
- Function Label: <F* label from `node scripts/todo-resolve-pr-context.mjs --issue <issue-number> --cwd "$(pwd)" --json`>
- Note: include this so follow-up review/fix work can resume the same Codex context and environment.

## Screenshots / recordings (if UI)

- Before/after or key states

## Risk / rollout notes

- Risk level: low/medium/high (with a sentence why)
- Rollout/flags/migration notes (if relevant)
