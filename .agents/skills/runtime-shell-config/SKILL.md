---
name: runtime-shell-config
description: Edit the mobile runtime shell config JSON for keyboard layouts and command menus, validate it, push it to dev, and tell the user to reload config in the app.
---

# Runtime Shell Config

Use this skill when the user wants to change the mobile shell keyboard layout,
keyboard macros, command menu presets, or submenu structure without changing the
runtime schema.

## Files

- Config JSON: `apps/mobile/config/shell-config.json`
- Schema: `apps/mobile/src/lib/shell-config.ts`
- Validation command: `pnpm --dir apps/mobile validate:shell-config`

## Guardrail

This skill edits JSON content only.

Stop and escalate to normal engineering workflow if the request requires:

- changing the JSON schema
- changing runtime loader/cache behavior
- adding new action semantics not already supported by the app
- changing keyboard behavior that is not already expressible through
  `keyboardRouting.actionTargets` or `keyboardRouting.oneShotReturnByKeyboardId`

## Workflow

1. Read `apps/mobile/config/shell-config.json`.
2. Read `apps/mobile/src/lib/shell-config.ts` only as needed to confirm the
   allowed shape and invariants.
3. Propose the exact JSON change briefly if the request is ambiguous.
4. Edit `apps/mobile/config/shell-config.json`.
5. Update metadata:
   - set `updatedAt` to current UTC ISO time
   - bump `version`
   - default version rule:
     - if current version starts with today’s UTC date as `YYYY-MM-DD.`, bump the
       numeric suffix by 1
     - otherwise set it to `YYYY-MM-DD.1`
6. Validate:

```bash
pnpm --dir apps/mobile validate:shell-config
pnpm --dir apps/mobile exec tsx --test test/integration/shell-config-schema.test.ts test/integration/keyboard-config.test.ts test/integration/command-presets.test.ts
```

7. Inspect the diff and make sure only intended config changes landed.
8. Commit on `dev` with a focused message like:

```bash
git add apps/mobile/config/shell-config.json
git commit -m "chore(mobile): update shell config"
```

9. Push to `dev`.
   - This skill assumes the current branch is `dev` or an explicitly intended
     config-publishing branch that will be pushed to `dev`.
   - If that is not true, stop and ask instead of guessing.
10. Tell the user to open the shell Configure modal and tap `Reload config`.

## Output

Report:

- what changed in the JSON
- validation commands run
- push status
- the new config `version`
- the exact next step: `Reload config` in the app
