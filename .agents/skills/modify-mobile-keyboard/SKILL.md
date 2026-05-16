---
name: modify-mobile-keyboard
description: Use when changing the Fressh mobile terminal keyboard, including key labels, bytes, text keys, macros, long-press options, keyboard routing, active keyboards, or publishing keyboard config changes to a device.
---

# Modify Mobile Keyboard

## Overview

Change the Fressh mobile terminal keyboard through the runtime shell config and
carry the change all the way to the device reload step. This skill is for JSON
config edits only; use normal engineering workflow if runtime code or schema
changes are required.

## Source of Truth

- Config: `apps/mobile/config/shell-config.json`
- Schema: `apps/mobile/src/lib/shell-config.ts`
- Actions: `apps/mobile/src/lib/keyboard-actions.ts`
- Macro script parser: `apps/mobile/src/lib/macro-scripts.ts`
- Device delivery: commit + push to `dev`, then tap `Reload config` in the
  shell Configure modal. Do not use `adb push` for normal keyboard config
  delivery.

The app fetches raw GitHub JSON from branch `dev` and caches the last valid
config in MMKV. OTA is not needed for JSON-only keyboard changes.

## Guardrails

Only edit `apps/mobile/config/shell-config.json` when using this skill.

Stop and switch to normal implementation workflow if the request needs:

- a new action ID or runtime behavior
- schema changes
- new UI rendering behavior
- changes outside the JSON config
- generated keyboard files under `apps/mobile/src/generated`

## Workflow

1. Confirm the current branch is `dev`:

```bash
git branch --show-current
```

If it is not `dev`, ask before publishing.

2. Inspect the keyboard config:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/summarize-keyboards.mjs
```

3. Read reference details only as needed:

- `references/keyboard-config.md` for slot shapes, common byte sequences,
  macro syntax, long-press examples, routing, and publish notes.

4. Make the smallest JSON edit that satisfies the request.

Use stable existing keyboard IDs unless the user asks for a new keyboard. Keep
the grid rectangular enough for the UI to remain predictable; the current phone
keyboard is 4 rows x 10 columns.

5. Bump metadata:

```bash
node .agents/skills/modify-mobile-keyboard/scripts/bump-shell-config-metadata.mjs
```

6. Validate:

```bash
.agents/skills/modify-mobile-keyboard/scripts/verify-keyboard-config.sh
```

7. Inspect the diff:

```bash
git diff -- apps/mobile/config/shell-config.json
```

Verify that only the requested keyboard config and metadata changed.

8. Commit and push:

```bash
git add apps/mobile/config/shell-config.json
git commit -m "chore(mobile): update keyboard config"
git push origin dev
```

9. Tell the user the exact device step:

Open the shell Configure modal and tap `Reload config`.

## Editing Rules

- Prefer existing `type: "bytes"`, `type: "text"`, `type: "macro"`, and
  `type: "action"` slots over adding runtime behavior.
- Use existing action IDs from `KNOWN_ACTION_IDS`; add code only outside this
  skill if a requested action does not exist.
- Macro IDs referenced by a keyboard must exist under
  `macrosByKeyboardId[<keyboardId>]`.
- Long-press options can be `text`, `bytes`, `macro`, or `action`; they do not
  use `span`.
- Keep `icon` as a string or `null`. Use existing lucide icon names already in
  the config when possible.
- Preserve unrelated formatting and ordering as much as practical.

## Output

Report:

- the keyboard keys/macros/routing changed
- validation commands run
- commit and push status
- new config `version`
- next device step: `Reload config` in the shell Configure modal
