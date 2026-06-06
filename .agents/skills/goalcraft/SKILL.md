---
name: goalcraft
description: >-
  Turn a rough draft, vague ambition, or messy task brief into a powerful Codex
  /goal objective for long-running autonomous work. Use when the user asks to
  write, improve, format, sharpen, stress-test, or activate a Codex goal, thread
  goal, durable goal, or /goal prompt.
---

# Goalcraft

## Core Contract

Convert messy intent into a compact, activation-ready Codex `/goal` objective
that keeps the agent moving until real completion evidence exists. A strong goal
defines a closed loop: choose the next action, run it, score progress against an
explicit evaluator or checklist, record the result, then continue or stop based
on evidence. Treat the `/goal` as a short launcher, not the full plan: default
to 1,600 characters or fewer, keep a normal ceiling of 2,200, and put rich
detail in companion notes or referenced files. The objective must still be less
than 4,000 characters. Prefer drafting the goal text only. Do not call
`create_goal`, `thread/goal/set`, or otherwise activate a goal unless the user
explicitly asks to start or set it.

For current Codex `/goal` mechanics, read
[references/codex-goal-contract.md](references/codex-goal-contract.md) when the
exact runtime behavior matters.

## Workflow

1. Identify the rough objective, workspace, and expected end state.
   - If the user supplied a draft, preserve their intent and tighten it.
   - If a repo or files are mentioned, inspect them before finalizing the goal.
   - If a critical success criterion is missing, ask the smallest necessary
     question; otherwise state assumptions.

2. Shape the goal around evidence, not effort. Use this list as input thinking,
   not as required output structure.
   - Destination: what must be true at the end.
   - Starting point: current context, repo, branch, artifact, issue, or known
     state.
   - Core objective: the concrete work to complete.
   - Scope: files, directories, systems, or task boundaries the agent should
     stay within.
   - Deliverables: concrete artifacts such as code paths, tests, PRs, reports,
     screenshots, or logs.
   - Must not regress: constraints, behavior to preserve, safety boundaries.
   - Autonomy rules: when to continue, when to ask, what to verify directly.
   - Checkpoint rhythm: how often to test, review, summarize progress, or pause.
   - Verification gates: commands, inspections, screenshots, evals, or other
     proof loops.
   - Done when: artifact-level acceptance criteria.
   - Stop conditions: blockers, destructive actions, missing credentials, user
     approval boundaries.
   - Success metric: the observable result that proves completion.

3. Design the feedback loop before drafting the final goal.
   - Identify the score: metric, checklist, test result, scorecard, artifact
     count, benchmark, manual-review packet, or other evidence that lets Codex
     decide whether progress improved, stalled, or completed.
   - Prefer a fast iteration evaluator plus a slower final gate. For example:
     cheap smoke test, subsampled eval, lint/typecheck, focused replay, or
     checklist during work; full suite, full replay, deploy check, visual
     review, or final report before done.
   - For multi-hour or multi-day goals, name or recommend durable tracking
     surfaces: a current plan/queue, experiment or attempt ledger,
     decision/rejection log, scratchpad or daily notes, and generated
     current-state summary when useful.
   - If the real goal cannot yet be measured, recommend a preliminary goal to
     create the checklist, evaluator, scorecard, or tracking files before
     starting the main autonomous loop.
   - Treat tracking files as part of the control loop, not optional
     documentation. They should help the next agent choose the next action
     without rereading the full conversation.

4. Keep the objective usable by Codex.
   - Hard limit: the objective text after `/goal ` must be less than 4,000
     characters.
   - Normal target: draft to 1,600 characters or fewer.
   - Normal ceiling: do not return a normal goal above 2,200 characters.
   - Treat 2,200 characters or more as a failed normal draft even if it is
     technically below the hard limit.
   - The `/goal` should be the compact execution contract. Put rationale,
     examples, candidate lists, detailed scorecards, and nonessential context in
     companion notes outside the `/goal` payload.
   - Make every requirement auditable against files, commands, PR state, logs,
     screenshots, or explicit user confirmation.
   - Include score-loop and tracking-file detail in the `/goal` only when
     execution-critical; otherwise put detailed evaluator/checklist/memory
     structure in companion notes or a referenced repo document.
   - Include exact commands only when they are already known from the repo or
     user.
   - Avoid hidden flags in slash text. `/goal --tokens 50K ...` is literal
     objective text in the TUI, not parsed syntax.
   - If a token budget is requested, present it separately from the objective
     text unless the target surface supports a separate budget field.
   - For complex or ambiguous work, recommend a planning/interview pass before
     setting the goal.
   - For very large work, include subagent/orchestration guidance only when the
     current Codex environment supports subagents and the work can be split into
     bounded, reviewable lanes.

5. Choose the output shape.
   - Always start with compact shape: Destination, Context, Scope, Preserve,
     Verify, Done/stop.
   - Do not use the full checklist as output structure unless the user
     explicitly asks for a verbose draft outside `/goal`.
   - Do not force every planning concept into the `/goal`. Reason with the full
     checklist, then compress related items before output.
   - Merge deliverables into Scope.
   - Merge must-not-regress into Preserve.
   - Merge autonomy and checkpoint rhythm into Done/stop.
   - Keep examples and candidate lists outside the goal unless they are
     essential execution constraints.
   - Section soft budgets: Destination 160, Context 220, Scope 360, Preserve
     240, Verify 300, Done/stop 320 characters.

6. Validate length before returning.
   - Put only the ready-to-paste `/goal ...` command in a temporary file or pipe
     it to this skill's bundled validator: resolve
     `scripts/validate_goal_length.py` relative to the directory containing this
     `SKILL.md`, then run it with `--target-chars 1600 --strict-target`.
   - The validator belongs to Goalcraft, not to the user's working project. Do
     not search the user's repository for `scripts/validate_goal_length.py`.
   - The script strips a leading `/goal ` and counts the actual objective Codex
     validates.
   - Validate once. If it fails the 1,600 target, do not gradually trim it.
     Discard the draft and switch immediately to emergency shape:
     `/goal Complete [objective] in [scope]. Preserve [constraints]. Verify with [checks/evidence]. Stop for [risks]. Done when [criteria].`
   - After emergency fallback, validate once against the hard limit using
     `--max-chars 3999`. It should normally be far below the limit.
   - Do not run iterative "make it a little shorter" loops. More than one failed
     normal validation means the draft shape failed, not the character counter.
   - Do not return a final goal until the validator passes.
   - If the bundled script path is unavailable, use this deterministic fallback
     on the file containing the exact final `/goal ...` command:

````bash
python3 - "$GOAL_FILE" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
if text.startswith("```"):
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    text = "\n".join(lines).strip()
if text.startswith("/goal") and text[len("/goal"):].startswith((" ", "\n", "\t")):
    text = text[len("/goal"):].strip()
count = len(text)
print(f"objective_chars={count}")
if count > 1600:
    raise SystemExit(1)
PY
````

7. Decide output mode.
   - Default: return a ready-to-paste `/goal ...` block plus a short assumptions
     list.
   - If the user asks for review, critique the draft first and include a revised
     version.
   - If the user explicitly asks to activate the goal, call the goal tool or
     app-server surface only after the objective is final and no existing active
     goal conflict is unresolved.

## Output Format

Return companion notes outside the goal when details should not spend objective
characters. Use this shape by default:

```markdown
Assumptions:

- ...

Ready-to-paste goal:

/goal Destination: ...

Context: ...

Scope: ...

Preserve: ...

Verify: ...

Done/stop: ...

Objective length: N characters

Notes outside the goal:

- ...
```

Omit companion notes only for trivial goals. For nontrivial goals, prefer a
short `/goal` plus useful companion notes over a long `/goal`. Do not put
assumptions, rationale, candidate lists, or optional details inside the `/goal`
unless they are execution-critical.

## Quality Bar

- The goal should be operationally sharp enough that another agent can continue
  after compaction or resume.
- The goal should make the next loop obvious: choose an action, run it, score
  it, record the result, and continue or stop.
- For long-running goals, the goal or companion notes should identify the
  durable state files or generated views that preserve plan, attempts,
  decisions, and current status.
- The ready-to-paste `/goal` should feel like a compact launcher. If it needs
  lots of nuance, put that nuance outside the goal or into a referenced file.
- The goal should make premature completion hard: "done" must require evidence,
  not intent, elapsed time, or passing unrelated checks.
- The goal should avoid over-prescribing implementation details unless those
  details are part of the actual requirement.
- The goal should preserve user boundaries: planning-only, no edits, no deploys,
  no commits, or approval requirements must be explicit when present.
- The final ready-to-paste goal should pass this skill's bundled
  `scripts/validate_goal_length.py --target-chars 1600 --strict-target`. If the
  normal draft fails, use the emergency compact shape and validate once against
  the hard 3,999-character maximum.
