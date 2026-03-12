# Skill PR Review Rubric (Checklist)

Use this checklist when reviewing changes to a skill, especially workflow/orchestrator skills like `git-pr`.

## Metadata + triggering

- [ ] Folder name matches `name` in `SKILL.md` frontmatter.
- [ ] `description` is specific (doesn’t over-trigger on generic “review code”).
- [ ] Scope is clear (not “does everything”).

## Structure + size

- [ ] `SKILL.md` is concise (aim < 500 lines).
- [ ] Large templates/checklists live in `references/` (no deep reference chains).
- [ ] SKILL links to all supporting files it expects to use.

## Context gathering

- [ ] Skill instructs gathering minimal required context (branch, base, diff target, dirty tree).
- [ ] Avoids assumptions unless confirmed (issue/PR, base branch, test expectations).

## Review quality

- [ ] Findings are actionable (problem + recommendation + acceptance criteria).
- [ ] Findings are prioritized (correctness/security → bugs → perf → maintainability → style).
- [ ] Multiple sources are merged into one de-duplicated queue.

## Interactive fix loop (human-in-loop)

- [ ] One item at a time: explain → recommend → ask Fix/Skip/Defer → (optional) implement → verify.
- [ ] Supports deferral with a “track later” note.

## Verification discipline

- [ ] Lists repo-appropriate verification commands (no vague “should pass”).
- [ ] Has a “verification gate” before claiming ready/shipping.
- [ ] Does not claim passing without fresh command output.

## Automation safety

- [ ] Push/PR/issue updates are opt-in and require explicit user approval.
- [ ] Destructive actions require explicit typed confirmation (e.g. `DISCARD`).

## Output artifacts

- [ ] PR body template exists and is consistently used.
- [ ] Issue update template exists and is consistently used.
- [ ] Screenshots guidance exists when UI changes are possible.

## Re-runnability

- [ ] Safe to re-run (idempotent instructions; clear stop conditions).
- [ ] Defines stop conditions (wrong base, huge diff, verification failing, etc.).
