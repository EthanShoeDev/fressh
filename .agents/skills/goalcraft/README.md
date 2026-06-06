# Goalcraft

Goalcraft turns a messy task description into a Codex `/goal` you can paste and
run.

When you use `/goal`, the agent runs autonomously toward whatever you wrote
down. A weak goal means the agent will claim "done" on something that isn't.
Goalcraft writes compact launcher goals that are tight on scope, clear on what
counts as done, and structured so the agent has to show real evidence before
declaring success. For long-running work, it also pushes the goal toward a tight
loop: choose an action, run it, score it with a fast evaluator or checklist,
record the result, and continue or stop based on evidence.

## Install

Clone the repo, then symlink it into your Codex skills directory:

```bash
git clone https://github.com/grp06/goalcraft.git
cd goalcraft
ln -s "$(pwd)" ~/.codex/skills/goalcraft
```

If your Codex setup uses a different skills directory, symlink the repo there
instead. The skill is self-contained; it does not depend on any local project
path.

Restart Codex, then invoke it with a rough brief. The brief doesn't need to be
clean — that's the point:

> Use `$goalcraft` to turn this into a Codex `/goal`:
>
> I need to clean up the billing settings page in the web app. It's kind of
> half-done from a previous pass. The upgrade button works but the loading and
> error states are janky, and I think mobile is probably broken. Please make it
> match the rest of the settings UI, don't touch the Stripe webhook stuff or
> pricing logic unless something is obviously wrong, and don't do a huge
> refactor. It should have tests or at least whatever checks this repo normally
> uses. I want Codex to keep going until the page is actually usable and
> verified, but it should stop and ask me before changing public APIs, database
> schema, or anything payment-risky.

## What you get back

A `/goal` that spells out:

- **Where things stand and what "done" looks like** — so the agent has a clear
  destination
- **What to work on, what to leave alone** — scope and non-negotiables
- **How to score progress** — the fast evaluator, checklist, scorecard, or
  metric that guides each loop
- **How to verify the work** — the final commands, tests, or checks that prove
  it shipped
- **Where to record state** — durable plan, experiment, decision, or notes files
  when the goal may run for hours or days
- **When to keep going vs. stop and ask** — autonomy rules for risky or
  ambiguous moves
- **What counts as success** — measurable criteria, not "looks good to me"

The `/goal` itself is intentionally short. Goalcraft puts supporting rationale,
examples, candidate lists, and detailed evaluator notes outside the goal unless
they are execution-critical.

By default, goalcraft only drafts the goal. It won't activate it unless you tell
it to.

## Length safety

Codex caps `/goal` text at 4,000 characters. Goalcraft targets 1,600 by default
and treats 2,200 as the normal draft ceiling, so the validator is a guardrail
rather than a repeated trimming loop. If a normal draft misses the target,
Goalcraft switches to a compact fallback instead of shaving a few characters
repeatedly. If you want to check a goal manually from this repo:

```bash
python3 scripts/validate_goal_length.py --target-chars 1600 --strict-target goal.txt
```

That script is bundled with this Goalcraft repo. When the skill is used while
working in another project, agents should resolve
`scripts/validate_goal_length.py` relative to Goalcraft's own `SKILL.md`, not
relative to the project being edited. If the skill runtime does not expose that
path, Goalcraft's instructions include an inline Python fallback that works
anywhere with Python 3.
