---
name: oracle
description: Best practices for using the oracle CLI (prompt + file bundling, engines, sessions, and file attachment patterns).
homepage: https://askoracle.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "🧿",
        "requires": { "bins": ["oracle"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "@steipete/oracle",
              "bins": ["oracle"],
              "label": "Install oracle (node)",
            },
          ],
      },
  }
---

# oracle -- best use

Oracle bundles your prompt + selected files into one "one-shot" request so another model can answer with real repo context. Treat output as advisory: verify against code + tests.

## Hard Rules For This Repo

- **Never use Oracle with the API engine in this repo.**
- **Always force browser mode. Do not rely on engine auto-pick.**
- If a model/provider would require `--engine api`, do not use Oracle for that run.
- If a command omits `--engine browser`, it is wrong for this repo.

### NEVER fall back to internal reasoning

- **When Oracle is invoked, you MUST wait for the Oracle response. No exceptions.**
- **Do NOT fall back to your own analysis, reasoning, or conclusions while Oracle is running.**
- If Oracle is taking a long time (browser runs with GPT-5.4 can take 10 min to 1+ hour), that is expected. **Wait patiently.**
- If the Oracle CLI detaches or times out, **reattach to the session** (`oracle session <id> --render`). Do NOT substitute your own answer.
- If after reattaching the session is still running, **check with the user** what to do. Ask: "Oracle is still running -- want me to keep waiting or take a different approach?"
- **The only valid escape from waiting is explicit user instruction.** You may not decide on your own to skip the Oracle result.
- If the Oracle run fails (crash, error, browser issue), report the failure to the user and ask how to proceed. Do NOT silently provide your own analysis as a replacement.

This rule exists because the entire point of Oracle is to get an external model's perspective. Falling back to internal reasoning defeats the purpose and produces misleading output that looks like it came from Oracle but didn't.

## Main Use Case (browser, GPT-5.4 Pro)

Default workflow here: `--engine browser` with GPT-5.4 Pro in ChatGPT. This is the common "long think" path: ~10 minutes to ~1 hour is normal; expect a stored session you can reattach to.

Recommended defaults:

- Engine: browser (`--engine browser`)
- Model: GPT-5.4 Pro (`--model gpt-5.4-pro`)

## Environment Setup

This repo uses direct Oracle browser mode on this machine. The browser should open locally and remain visible in RDP.

Recommended local defaults:

- Display: `:11`
- Engine: `browser`
- Model: `gpt-5.4-pro`
- Preferred browser: local Google Chrome profile
- Explicit cookie fallback: `~/.config/google-chrome/Default/Cookies`

If the browser window is not visible in RDP, bring it forward:

```bash
DISPLAY=:11 xdotool search --name "ChatGPT" windowactivate windowraise windowmove 0 0 windowsize 1280 720
```

## Golden Path

1. Pick a tight file set (fewest files that still contain the truth).
2. Preview payload + token spend (`--dry-run` + `--files-report`).
3. Run plain `oracle` in browser mode directly on this machine.
4. If the run detaches or times out, reattach to the stored session instead of rerunning.

## Commands (preferred)

- Help:
  - `oracle --help`
  - If the binary is not installed: `npx -y @steipete/oracle --help`

- Preview (no tokens):
  - `DISPLAY=:11 oracle --dry-run summary --engine browser --model gpt-5.4-pro -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - `DISPLAY=:11 oracle --dry-run full --engine browser --model gpt-5.4-pro -p "<task>" --file "src/**"`

- Token sanity:
  - `DISPLAY=:11 oracle --dry-run summary --files-report --engine browser --model gpt-5.4-pro -p "<task>" --file "src/**"`

- Browser run (main path; long-running is normal):
  - `DISPLAY=:11 oracle --engine browser --model gpt-5.4-pro -p "<task>" --file "src/**"`

- Browser run with explicit cookie fallback:
  - `DISPLAY=:11 oracle --engine browser --model gpt-5.4-pro --browser-cookie-path ~/.config/google-chrome/Default/Cookies -p "<task>" --file "src/**"`

- Reattach to sessions:
  - `oracle status --hours 72`
  - `oracle session <id> --render`

- Manual paste fallback:
  - `oracle --render --copy -p "<task>" --file "src/**"`
  - Note: `--copy` is a hidden alias for `--copy-markdown`.

## Attaching Files (`--file`)

`--file` accepts files, directories, and globs. You can pass it multiple times; entries can be comma-separated.

- Include:
  - `--file "src/**"`
  - `--file src/index.ts`
  - `--file docs --file README.md`

- Exclude:
  - `--file "src/**" --file "!src/**/*.test.ts" --file "!**/*.snap"`

- Defaults (implementation behavior):
  - Default-ignored dirs: `node_modules`, `dist`, `coverage`, `.git`, `.turbo`, `.next`, `build`, `tmp` (skipped unless explicitly passed as literal dirs/files).
  - Honors `.gitignore` when expanding globs.
  - Does not follow symlinks.
  - Dotfiles filtered unless opted in via pattern (e.g. `--file ".github/**"`).
  - Files > 1 MB rejected.

## Engines

- In this repo, Oracle is **browser-only**.
- Never rely on engine auto-pick.
- Always pass `--engine browser`.
- Preferred model here is `gpt-5.4-pro` in browser mode.
- If the desired model is unavailable in browser mode, stop and choose a different workflow instead of using API mode.
- Browser attachments:
  - `--browser-attachments auto|never|always` (auto pastes inline up to ~60k chars then uploads).
- Model picker troubleshooting:
  - `--browser-model-strategy current` keeps the active ChatGPT model instead of trying to switch it.
- Cookie fallback:
  - `--browser-cookie-path ~/.config/google-chrome/Default/Cookies`
- Use direct browser mode on this machine; do not route runs through `oracle serve` for the normal repo workflow.

## Sessions + Slugs

- Runs may detach or take a long time (browser + GPT-5.4 Pro often does). If the CLI times out: do not rerun; reattach to the stored session.
  - List: `oracle status --hours 72`
  - Attach: `oracle session <id> --render`
- Use `--slug "<3-5 words>"` to keep session IDs readable.
- Use `--force` only when you truly want a fresh run.

## Prompt Template (high signal)

Oracle starts with **zero** project knowledge. Assume the model cannot infer your stack, build tooling, conventions, or "obvious" paths. Include:

- Project briefing (stack + build/test commands + platform constraints).
- "Where things live" (key directories, entrypoints, config files, boundaries).
- Exact question + what you tried + the error text (verbatim).
- Constraints ("don't change X", "must keep public API", etc).
- Desired output ("return patch plan + tests", "give 3 options with tradeoffs").

## Safety

- Don't attach secrets by default (`.env`, key files, auth tokens). Redact aggressively; share only what's required.
- Do not use Oracle API mode to bypass browser limitations or save time. In this repo that is considered a misuse of the tool.

## "Exhaustive Prompt" Restoration Pattern

For long investigations, write a standalone prompt + file set so you can rerun days later:

- 6-30 sentence project briefing + the goal.
- Repro steps + exact errors + what you tried.
- Attach all context files needed (entrypoints, configs, key modules, docs).

Oracle runs are one-shot; the model doesn't remember prior runs. "Restoring context" means re-running with the same prompt + `--file ...` set (or reattaching a still-running stored session).
