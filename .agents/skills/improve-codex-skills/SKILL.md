---
name: improve-codex-skills
description: Use when improving Codex skills from session logs or trace evidence.
---

# Improve Codex Skills

Use Codex session logs and `codex exec --json` traces for focused analysis of
one target skill or session-level postmortems of workflow/tooling failures. The
workflow identifies evidence of skill use or session friction, diagnoses
workflow gaps, reviews token usage when available, and produces report-only
improvement suggestions.

Use the direct session helpers when the request is only to locate or summarize a
stored session before deciding which skill needs focused analysis.

## Quick Start

Focused mode:

```bash
python3 skills/improve-codex-skills/scripts/analyze.py \
  --skill code-review
```

Session-level postmortem mode:

```bash
python3 skills/improve-codex-skills/scripts/analyze.py \
  --postmortem \
  --session-id <id>
```

Find and summarize a stored Codex session directly:

```bash
skills/improve-codex-skills/scripts/find-session-log.sh --sessionId <id>
skills/improve-codex-skills/scripts/summarize-session.sh --sessionId <id>
```

Prefer a bare skill name in the current repo. Override the trace source only
when needed:

- `--session-id <id>` for stored Codex session JSONL
- `--log <path>` for a stored session JSONL path
- `--trace <path>` for a saved `codex exec --json` trace
- `--log-cwd <path>` to use the latest stored session log whose recorded `cwd`
  matches that folder
- `--log-cwd env5` as shorthand for `~/cube9-env5/app`

Default assumptions:

- Bare skill names resolve to the current repo's `.agents/skills/<name>`.
- `.agents` is the default skill variant. Use `.claude` only when explicitly
  requested.
- If no trace source is provided, use the best stored session log for the
  current repo with this balanced ranking policy: execution evidence first,
  durable-artifact evidence second, structured invocation evidence third,
  consult-path evidence fourth, declaration-only evidence last, then interactive
  CLI originator, then recency.
- Declaration markers are valid only when the session also shows real tool
  activity. Announcement-only sessions should never win auto-selection.
- System-reminder blocks that list available skills produce false-positive
  declaration hits for every listed skill. When scanning for skill references,
  prefer evidence from `event_msg.user_message` and `event_msg.agent_message`
  content over raw message text that may contain pasted skill catalogs.
- Bare skill names stay scoped to the default `.agents` variant. They should not
  use variant-agnostic declaration or durable-artifact markers.
- For explicit selectors, preserve caller intent first: keep `.claude/...`
  variant matching strict, keep repo-relative aliases for in-repo explicit
  paths, and allow external relative selectors to match both their raw and
  resolved forms.
- If the user names another folder and does not pin a log path, use the best
  stored session log for that folder with the same preference order.
- If the user says `env5`, interpret it as `~/cube9-env5/app`. Apply the same
  `envN -> ~/cube9-envN/app` shorthand for other env folders.
- Always generate artifacts under this repo's
  `docs/tool-output/improve-codex-skills/<run-id>/`, even when the examined log
  came from another checkout.

Judge behavior:

- `--judge on` is the default and runs the evidence-first Codex judge stage.
- `--judge off` disables the judge and keeps the run deterministic-only for
  local debugging.
- `--use-codex` is a backward-compatible alias only. Do not treat it as the
  primary workflow in new guidance.

## Workflow

### Focused Analysis

1. Resolve the target skill path. Bare skill names resolve under the current
   repo's `.agents/skills/`. Use an explicit path only when the user clearly
   asks for a different skill variant or checkout.
2. Resolve the trace source.
   - For session ids, reuse `scripts/find-session-log.sh` and
     `scripts/summarize-session.sh`.
   - If no explicit source is provided, select the best stored session log whose
     recorded `cwd` matches the current repo. Use the balanced ranking policy
     from the default assumptions rather than raw recency alone.
   - Count durable-artifact paths only when they appear inside command payloads.
     Ignore free-text artifact mentions.
   - For bare skill names, keep the match scoped to `.agents`-path evidence. Use
     an explicit selector when you want declaration or artifact markers to
     participate.
   - Allow declaration markers to break ties only when the trace also shows
     function-call activity. Do not let announcement-only sessions win.
   - If the user points at another folder but does not pin a log, pass
     `--log-cwd <folder>` and select the best stored session log whose recorded
     `cwd` matches that folder using the same policy.
   - Accept `env5` as shorthand for `~/cube9-env5/app` when you need a folder
     hint. Apply the same `envN` shorthand for similar env folders.
   - Reject legacy rollout `.json` files instead of guessing.
   - If the source is stored session JSONL, read
     [references/trace-shapes.md](references/trace-shapes.md) only if the event
     layout looks unfamiliar.
   - If the source is `codex exec --json`, read
     [references/trace-shapes.md](references/trace-shapes.md) before diagnosing
     so you use the supported event families.
3. Run `scripts/analyze.py` to normalize the trace, redact sensitive values,
   build a transcript and evidence pack, and generate artifacts under the
   current repo's `docs/tool-output/improve-codex-skills/<run-id>/`.
   - The workflow is report-only: findings plus suggested change targets, not
     patch diffs.
   - Read [references/patch-policy.md](references/patch-policy.md) before
     widening the suggested scope beyond `SKILL.md`.
   - Read
     [references/judge-output.schema.json](references/judge-output.schema.json)
     or
     [references/postmortem-judge-output.schema.json](references/postmortem-judge-output.schema.json)
     only when reviewing or editing the relevant judge contract. Do not load
     either schema just to run a normal analysis.
   - Keep the judge evidence-first. Do not pass raw unredacted traces to the
     judge stage.
4. Review token usage before finalizing findings.
   - If the log exposes token accounting, read the token section in `report.md`
     and look for concrete ways to save tokens.
   - Focus on repeated retries, oversized repeated context, and unnecessary
     reference loading.
   - If token accounting is missing from the log, state that token review was
     unavailable instead of guessing.
5. Read `report.md` first. Use `transcript.md` for the walk transcript,
   `evidence.json` for judge input, `diagnosis.json` for raw findings,
   `suggestions.json` for structured change suggestions, and `rerun.md` for
   exact rerun commands.
6. Treat the judge as the default scoring and suggestion stage. If the judge
   fails, use the deterministic findings and local suggestion summary in
   `report.md`.

### Session Postmortem

Use `--postmortem` when the session failure spans tools, workflow, multiple
skills, subagent orchestration, evidence durability, or token/context friction.
Do not force a target skill when the useful diagnosis is session-level.

Postmortem mode is report-only. It does not patch skills, create GitHub issues,
or infer one skill as the culprit.

Review artifacts in this order:

1. `postmortem-report.md` for the human-readable postmortem.
2. `postmortem-facts.json` for observed facts extracted from the redacted trace.
3. `postmortem-suggestions.json` for inferred recommendations and backlog items.
4. `transcript.md` for the redacted session transcript.
5. `judge-output.json` only when the judge stage ran, failed, or was skipped.
6. `rerun.md` for the exact rerun command.

Keep observed facts and inferred recommendations separate. The judge may rank or
summarize recommendations, but it must not introduce uncited facts.

## Escalation Table

| Situation | Judge On | Judge Off |
|-----------|----------|-----------|
| Normal trace review | Yes | No |
| Local debugging or prompt iteration | Optional | Yes |
| Evidence is weak, mixed, or low-signal | Yes, expect diagnosis-only | Optional |
| Judge CLI/model unavailable | Falls back locally | Yes |
| You want to inspect deterministic findings only | Optional | Yes |

## Decision Rules

- In focused mode, require an explicit target skill name. Do not infer the
  target skill from the log alone.
- Use `--postmortem` instead of focused mode when the request is to explain a
  whole workflow failure rather than improve one named skill.
- In postmortem mode, do not require or infer a target skill.
- Bare skill names resolve under the current repo's `.agents/skills/` and should
  be the default.
- Use explicit skill paths only when the user clearly overrides the current repo
  default.
- Keep the analysis local-first. Redact traces before the judge stage.
- Logs may come from another checkout, but the reviewed skill and emitted
  artifacts stay in the current repo unless explicitly overridden.
- Treat `SKILL.md` as the default suggestion target.
- Allow `references/` suggestions only when the evidence points to reusable
  guidance or schemas.
- Allow `scripts/` suggestions only when the log shows repeated deterministic
  gaps.
- Never auto-apply changes. This skill only reports findings and suggests what
  should change.

## Never Do

- In focused mode, never infer the target skill from the trace alone. Require an
  explicit target so the skill does not patch the wrong package.
- Never switch the reviewed skill to the log's original checkout just because
  the session `cwd` points elsewhere.
- Never accept legacy rollout `.json` logs by guessing at their shape. A guessed
  parser produces fake findings.
- Never widen a suggested change into `references/` or `scripts/` unless the
  evidence and judge breakdowns explicitly support that category.
- Never stuff one-off prompt fragments into frontmatter just because they
  appeared in a single trace. That overfits routing metadata to noise.
- Never write artifacts into the examined checkout. Keep them in the current
  repo.
- Never emit ready-to-apply instructions, candidate skill copies, or patch-ready
  status. This workflow stops at findings plus suggested changes.
- Never document census, mdev, or tmux selector commands as active workflows
  until their analyzer support lands.

## References

- Use [references/trace-shapes.md](references/trace-shapes.md) for unfamiliar
  event layouts or any `codex exec --json` trace.
- Use [references/patch-policy.md](references/patch-policy.md) before escalating
  beyond a local `SKILL.md` patch.
- Use
  [references/judge-output.schema.json](references/judge-output.schema.json)
  only when validating or editing the focused-mode judge contract.
- Use
  [references/postmortem-judge-output.schema.json](references/postmortem-judge-output.schema.json)
  only when validating or editing the postmortem judge contract.
- Do not load
  [references/patch-proposal.schema.json](references/patch-proposal.schema.json)
  unless you are debugging the legacy patch-only schema.

## Low-Signal Fallback

If the trace is parseable but the evidence is weak or contradictory:

- Stop at diagnosis instead of forcing a diff.
- Keep the report focused on missing evidence, not speculative fixes.
- Prefer one concrete rerun instruction that would improve the next trace.
- Expect the judge to return `diagnosis_only: true` in this case.

## Report Checks

- For focused mode, trust `report.md`, `diagnosis.json`, and
  `suggestions.json` more than intuition.
- For postmortem mode, trust `postmortem-report.md`,
  `postmortem-facts.json`, and `postmortem-suggestions.json` more than
  intuition.
- If a command or tool call failed twice with the same root cause in the trace,
  surface that in the findings and suggested changes instead of retrying it
  again.
- In focused mode, confirm that `evidence.json` exists and is redacted before
  reviewing judge findings.
- In postmortem mode, confirm that `postmortem-facts.json` exists and separates
  observed facts from inferred recommendations before reviewing judge findings.
- Confirm that `judge-output.json` exists when the judge stage ran, or contains
  skipped or failed status when it did not.
- Confirm that `rerun.md` includes an exact rerun command for the same trace
  source.
- If token usage is available, confirm the report includes a token review
  section with concrete savings opportunities or an explicit note that none were
  evident.
