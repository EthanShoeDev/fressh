# Command Menu mdev Actions Design

## Overview

Issue 91 asks for the config menu to be easier to reach from the main mobile
keyboard. The current main keyboard already has a `Cmds` key that opens the
runtime command menu, but the menu only supports terminal command presets and
submenus. Native app behavior, such as opening the feature request flow, is only
reachable through keyboard action slots or the Configure modal.

This design moves only `Request a Feature` into the command menu as a native app
action and reorganizes the command tree around the user's current mobile tmux
workflow. The rest of the Configure modal remains unchanged.

## Goals

- Make `Request a Feature` reachable from the main keyboard through `Cmds`.
- Rebuild the command menu tree to match the approved structure exactly.
- Add a future-ready command menu entry type for native app actions.
- Keep workspace lifecycle commands in the command menu as terminal command
  presets using existing `mdev` tmux commands.
- Keep the existing Configure modal available for config-only actions.
- Validate the new command menu shape with focused tests.

## Non-Goals

- Do not move `Reload config`, `Host config`, `GitHub issues`, `Dev server`, or
  `Shell config docs` out of Configure.
- Do not add new remote `mdev` commands.
- Do not add native Workmux bridge operations for workspace open, close, or
  rename in this change.
- Do not redesign the command modal's visual layout beyond what is necessary to
  run native action entries.
- Do not change the main keyboard grid or the `Cmds` key.

## Approved Command Tree

The command menu should become:

```text
Cmds
├── /new
├── superpower
│   ├── $test-driven-development
│   ├── $systematic-debugging
│   ├── $verification-before-completion
│   ├── $brainstorming
│   ├── $writing-plans
│   ├── $executing-plans
│   ├── $dispatching-parallel-agents
│   ├── $subagent-driven-development
│   ├── $subagent-driven-development-ce1
│   ├── $requesting-code-review
│   ├── $receiving-code-review
│   ├── $finishing-a-development-branch
│   ├── $writing-skills
│   └── $using-superpowers
├── features
│   ├── $work-on-bug
│   ├── $work-on-bug-reflect
│   ├── $work-on-issue
│   ├── $dev-work-on-commission-bug
│   ├── $work-step-by-step
│   ├── $tldr
│   ├── /rloop-review
│   └── $oracle-ask
├── Git
│   ├── $git-pr
│   ├── dev pull status
│   ├── git checkout dev
│   ├── git pull
│   ├── git status
│   └── clear
├── mdev
│   ├── Request a Feature
│   ├── Open Workspace
│   ├── Close Workspace
│   ├── Rename Workspace
│   ├── codex auth refresh new
│   └── codex auth refresh
└── core8
    ├── yarn cq
    ├── yarn test:ci
    ├── core8 env fix
    ├── core8 jobs switch T0
    └── core8 env switch staging
```

## Command Behavior

`Request a Feature` is a native app action. Selecting it from
`Cmds > mdev > Request a Feature` should invoke the same behavior as the
existing `OPEN_REPO_FEATURE_REQUEST` keyboard action: close competing command
surfaces as needed and open the existing feature request modal.

Workspace entries remain terminal command presets:

| Label | Command |
| --- | --- |
| `Open Workspace` | `mdev tmux open-workspace` then Enter |
| `Close Workspace` | `mdev tmux workspace close` then Enter |
| `Rename Workspace` | `mdev tmux workspace prompt-rename` then Enter |

Both Codex auth entries run the same command for this change:

| Label | Command |
| --- | --- |
| `codex auth refresh new` | `mdev codex auth refresh` then Enter |
| `codex auth refresh` | `mdev codex auth refresh` then Enter |

The duplicate command is intentional. The labels reserve two separate menu
affordances so their behavior can diverge later without changing the menu shape.

## Runtime Config Model

Extend `CommandPresetEntry` with a native action entry:

```ts
type CommandActionEntry = {
	type: 'action';
	label: string;
	actionId: ActionId;
};
```

Then make command menu entries a union of:

- existing `preset` entries that send terminal command steps;
- existing `submenu` entries that contain nested command menu entries;
- new `action` entries that call the same action dispatcher used by keyboard
  action slots.

The schema should validate `actionId` the same way keyboard action slots do:
the value must be a supported config action id. The first use is
`OPEN_REPO_FEATURE_REQUEST`.

## UI And Data Flow

`CommandPresetsModal` already renders a stack of command menu entries. It should
continue to deduplicate labels per active menu and reset navigation state when
closed.

The modal selection flow should branch by entry type:

- `submenu`: push the submenu onto the modal's stack.
- `preset`: call the existing `onSelect(preset)` callback.
- `action`: call a new `onAction(actionId)` callback and reset the menu stack.

`apps/mobile/src/app/shell/detail.tsx` should pass `handleAction` into
`CommandPresetsModal`. The existing action dispatcher already knows how to open
the feature request modal through `openRepoFeatureRequest`.

`runCommandPreset` remains responsible only for terminal presets. Native action
entries should not be converted into command steps and should not write text to
the terminal.

## Error Handling

Malformed runtime config should fail validation before it reaches the shell:

- an unknown command menu entry type is invalid;
- an action entry with an unsupported `actionId` is invalid;
- a submenu may contain presets, submenus, and action entries.

At runtime, selecting an action entry whose handler is missing should follow the
existing action dispatcher behavior: log an unhandled action warning and avoid
terminal writes.

Workspace command failures are not handled by the mobile app in this change.
They are normal terminal commands and will surface in the terminal or tmux prompt
exactly as they do today.

## Testing

Add focused tests around these behaviors:

- `parseShellConfigData` accepts `commandMenus` entries with
  `{ type: 'action', label, actionId }`.
- `parseShellConfigData` rejects unsupported action ids in command menu action
  entries.
- Bundled `shell-config.json` exposes the approved command tree exactly,
  including the moved and renamed command menu entries.
- Selecting a command menu `action` entry calls the provided action callback and
  does not call the terminal preset selection callback.
- Selecting `Request a Feature` through the command menu opens the existing
  feature request path through `OPEN_REPO_FEATURE_REQUEST`.

Run shell config validation and the focused mobile integration tests covering
shell config, command presets, keyboard actions, and shell modal/action routing.

## Files Expected To Change Later

- `apps/mobile/src/lib/shell-config.ts`
  - add the command menu action entry type and Zod schema;
  - validate command menu action ids.
- `apps/mobile/src/app/shell/components/CommandPresetsModal.tsx`
  - render action entries as selectable rows;
  - call `onAction(actionId)` for native action entries.
- `apps/mobile/src/app/shell/detail.tsx`
  - pass `handleAction` to `CommandPresetsModal`.
- `apps/mobile/config/shell-config.json`
  - update the command tree to the approved structure.
- `apps/mobile/test/integration/keyboard-config.test.ts`
  - assert the bundled command menu tree and relevant labels.
- `apps/mobile/test/integration/shell-config-schema.test.ts`
  - cover command menu action schema acceptance and rejection.
- `apps/mobile/test/integration/command-presets.test.ts` or
  `apps/mobile/test/integration/shell-modals.test.ts`
  - cover command modal action dispatch.

## Rollout

This is a bundled runtime config and app runtime change. Existing installed apps
will receive the behavior through the normal preview build or OTA path once the
JavaScript and bundled config are shipped. Because the schema changes, a remote
JSON reload containing command action entries requires an app version that knows
the new schema.

No persisted data migration is required.
