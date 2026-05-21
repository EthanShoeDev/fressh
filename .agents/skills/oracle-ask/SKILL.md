---
name: oracle-ask
description: Manual-only custom skill. Use only when explicitly requested as $oracle-ask or named directly.
---


# oracle-ask -- Cube9/Core8 workflow

Use ChatGPT only through the repo wrapper below.

## Hard Rules

- Browser only. Do not use raw `agent-browser` as the normal path.
- Use the predefined wrapper only:
  - `./ask-and-wait --session ... --config ...`
- Do not try `bash ask-and-wait ...`; it is a `zx` entrypoint, not a shell script.
- If `./ask-and-wait` itself is not executable, the only acceptable launch fallback is `./node_modules/.bin/zx ask-and-wait ...`.
- Do not build your own polling loop around `./ask check`.
- Do not fall back to your own reasoning while the wrapper is still running.
- Do not treat ChatGPT as if it already knows the repo. It starts with zero project knowledge.
- If the wrapper reaches a real terminal state, use it instead of pretending ChatGPT answered.

## One Command

Run oracle-ask like this:

```bash
./ask-and-wait --session env9-bug-review --config .tmp/env9-bug-review.json
```

Optional browser diagnostic:

```bash
./ask browser status
```

What the wrapper already does for you:

- starts or reuses the canonical `~/.ask/browser-profile`
- uploads files, writes the prompt, sends it, and waits
- returns structured JSON with a usable `answer` or a terminal failure state

## Wait Policy

The wrapper owns waiting.

- start the wrapper once
- keep waiting while the wrapper is healthy
- terminal outcomes are `completed`, `timeout`, and `error`
- if it returns an `answer`, use it
- if it returns `timeout` or `error`, report the exact returned failure and stop
- if browser status or the wrapper reports `authState=login_required`, stop and say the canonical profile at `~/.ask/browser-profile` needs login
- if the wrapper is still running, it is still authoritative

## Files And Prompting

ChatGPT starts with zero repo knowledge. Keep the prompt explicit and attach only the files that contain the truth.

### Minimum prompt shape

- short project briefing
- exact task or question
- constraints
- desired output format

Use this shape:

```text
You are reviewing code in the Cube9/Core8 repo.

Task:
[exact task]

Context:
[1-3 sentence repo or feature context]

Constraints:
- [constraint]
- [constraint]

Output format:
- [required shape]
```

### Ask patterns

- Code review:
  - ask for findings first, ordered by severity
  - ask for bugs, regressions, brittle assumptions, and missing tests
  - ask it to stay grounded in the attached diff and files only

- Bug analysis:
  - ask for the most likely root cause first
  - ask for concrete evidence with file references
  - ask for missing evidence only when the attached files are insufficient

- Implementation planning:
  - ask for a concrete plan, not a design essay
  - ask for interface changes, data flow, failure cases, and tests
  - ask it to call out assumptions clearly

- Comparison or document critique:
  - ask for the verdict first
  - ask for mismatches, omissions, and contradictions
  - ask for evidence from the attached sources only

### File usage

Attach the smallest truthful file set.

- for code review, prefer the real diff plus the changed files
- for bugs, include the failing path and the nearest shaping types or utilities
- for planning, include the current entrypoint and the main helper or docs involved
- prefer exact files over folders
- exclude generated output, caches, and secrets unless they are the subject
- if the branch is large, split the request into subsystem-sized reviews

## Session Naming

Use one explicit session name per task.

Session names are single-use for this wrapper. If you need to rerun the same task, use a new retry suffix instead of reusing the exact same session name.

Session naming is deterministic:

- derive the environment token from the current `pwd`
- expect a path shaped like `/home/<user>/cube-env<n>/app` or `/home/<user>/cube9-env<n>/app`
- extract the `env<n>` fragment from that path
- generate a task slug from the concrete task you are doing
- format: `<env-token>-<task-slug>`

Task slug generation rules:

- lowercase only
- words separated by `-`
- keep it short, usually 2 to 4 words
- prefer the primary object or goal, not generic filler

Examples for this repo:

- `env9-bug-review`
- `env9-bug-review-r2`
- `env9-hubspot-sync`
- `env9-pr9020-check`

If no `env<n>` fragment can be extracted from `pwd`, stop and say that the workspace path does not match the expected naming convention instead of inventing a session prefix.

## Config

Create a JSON config file with:

```json
{
  "prompt": "your full prompt text here",
  "files": ["/absolute/path/to/file1", "/absolute/path/to/file2"]
}
```

Use absolute file paths. Keep the config in `.tmp` by default.

## Result Handling

When the wrapper completes with a usable answer:

1. read the returned JSON
2. use the `answer` field as ChatGPT's result

When the wrapper completes with `timeout` or `error`:

1. read the returned JSON
2. inspect `diagnostic` if it is present
3. report the real timeout or failure state instead of pretending ChatGPT answered

Do not rerun oracle-ask just because the local session looked partial. If the wrapper is still running, keep waiting for its terminal result.
