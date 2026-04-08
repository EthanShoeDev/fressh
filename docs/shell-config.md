# Runtime Shell Config

The mobile shell now uses a single runtime JSON file for both keyboard layouts
and command menus:

- Source of truth: `apps/mobile/config/shell-config.json`
- Runtime schema: `apps/mobile/src/lib/shell-config.ts`
- Runtime cache/reload: `apps/mobile/src/lib/shell-config-store.ts`
- Native MMKV adapter: `apps/mobile/src/lib/shell-config-store-native.ts`

## How It Works

- The app bundles `apps/mobile/config/shell-config.json` for first launch.
- The shell screen loads the last valid cached config from MMKV if present.
- The Configure modal can fetch the latest JSON from GitHub raw on branch `dev`
  and apply it immediately without OTA or app restart.
- Invalid remote JSON is rejected and the current config stays active.

## Schema Highlights

- `defaultKeyboardId` selects the fallback active keyboard.
- `activeKeyboardIds` is the authoritative list of selectable keyboards.
- `keyboardRouting.actionTargets` maps keyboard navigation action IDs like
  `OPEN_ADVANCED_KEYBOARD` to active keyboard IDs.
- `keyboardRouting.oneShotReturnByKeyboardId` defines keyboards that should snap
  back to another active keyboard after a key press or copy action.
- `commandMenus` defines the command modal tree.

## Validate The JSON

From the repo root:

```bash
pnpm --dir apps/mobile validate:shell-config
```

Or validate a different file:

```bash
pnpm --dir apps/mobile validate:shell-config apps/mobile/config/shell-config.json
```

## Editing Workflow

- Preferred path: use the `runtime-shell-config` skill.
- That skill edits JSON only, validates it, updates `version` and `updatedAt`,
  commits and pushes to `dev`, then tells the user to tap `Reload config` in the
  app.
- If a requested change needs schema/runtime code changes instead of pure JSON
  edits, do not use the skill for the whole task. Use normal design +
  implementation workflow instead.

## Notes

- There is no runtime fallback to generated keyboard TS or hardcoded command
  preset TS anymore.
- `react-ttyd` may still exist as optional tooling, but it is not the mobile
  runtime source of truth.
