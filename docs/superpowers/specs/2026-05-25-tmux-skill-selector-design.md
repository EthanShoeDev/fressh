# Tmux Skill Selector Design

## Goal

Replace the current mobile keyboard `$` key with a first-class skill selector.
The selector discovers Codex skills from the active terminal repository, filters
them locally as the user types, and inserts the selected `$skill-name` without
pressing Enter.

## Scope

This change applies to the mobile shell keyboard and shell detail screen. The
first version is limited to tmux-enabled connections because the app can resolve
the active pane cwd through tmux today.

Discovery is limited to repository-local Codex skills under:

```text
<active-pane-cwd>/.codex/skills/*/SKILL.md
```

The selector must not scan global Codex skills, user skills, plugins, or
`.agents/skills`.

## Behavior

Pressing the keyboard key that currently types `$` opens a `Skills` selector
instead of sending `$` to the terminal.

On open, the app resolves the active tmux pane path, runs a side-channel command
to inspect repo-local skill files, and shows a searchable list. The user can
type a few characters to filter by skill name or description.

The first version does not cache skill lists. Each time the selector opens, it
discovers skills from the active tmux pane cwd again.

Selecting a skill closes the selector and sends `$skill-name ` to the terminal.
The selector never sends Enter automatically. Canceling closes the selector
without sending input.

If the connection is not tmux-enabled, the selector shows an inline error:
`Skill selector requires a tmux-enabled connection.`

## Keyboard Action

Add a first-class keyboard action ID:

```text
OPEN_SKILL_SELECTOR
```

The bundled shell config replaces the raw `$` text slot with a macro slot.
The macro, named `skill_selector`, dispatches the action:

```json
{
	"type": "action",
	"actionId": "OPEN_SKILL_SELECTOR"
}
```

This keeps the key configurable through existing macro wiring while giving the
runtime a clear action boundary for opening the selector.

## Components

Add a focused skill discovery module at
`apps/mobile/src/lib/skill-discovery.ts` for pure logic:

- Build the remote shell command for a pane path.
- Parse returned JSON into skill records.
- Extract `name` and `description` from `SKILL.md` frontmatter.
- Fall back to the skill directory name when frontmatter omits `name`.
- Filter and rank skills by query.

Add `SkillSelectorModal` under the shell components folder. It owns:

- Filter text.
- Loading, error, empty, and results states.
- Retry.
- Skill selection and cancel controls.

The shell detail screen owns:

- Opening and closing the modal.
- Resolving the tmux pane path with the existing tmux pane-path command.
- Running discovery through the existing side-channel SSH command helper.
- Sending the selected `$skill-name ` text to the terminal.

## Data Flow

1. User presses the keyboard skill key.
2. The key runs the `skill_selector` macro.
3. The macro dispatches `OPEN_SKILL_SELECTOR`.
4. Shell detail opens `SkillSelectorModal` and starts discovery.
5. Shell detail resolves the active tmux pane cwd.
6. Discovery runs a side-channel command against
   `<cwd>/.codex/skills/*/SKILL.md`.
7. The modal filters discovered skills as the user types.
8. Selecting a skill sends `$skill-name ` to the terminal and closes the modal.

## Error Handling

If no SSH connection exists, show `No SSH connection available.`

If tmux is disabled, show
`Skill selector requires a tmux-enabled connection.`

If the pane path cannot be resolved, show the pane-path failure message from the
existing resolver.

If `.codex/skills` does not exist, or no valid `SKILL.md` files are found, show
an empty state rather than an alert.

If the remote command fails unexpectedly, show an inline error and keep Retry
available.

Retry reruns discovery for the currently open selector. It is not a persistent
refresh or cache invalidation control because the first version has no cache.

## Testing

Add integration or unit coverage for:

- Skill discovery parses valid frontmatter.
- Discovery falls back to the directory name when frontmatter omits `name`.
- Discovery handles missing descriptions, malformed files, and empty output.
- Filtering matches skill names and descriptions.
- The bundled keyboard config no longer exposes the raw `$` text key.
- The bundled keyboard config wires the replacement key through the
  `skill_selector` macro/action.
- `OPEN_SKILL_SELECTOR` is accepted by keyboard action/schema validation.
- The selector inserts `$skill-name ` and does not send Enter.

If shell-level React Native component testing is impractical, cover the modal
through focused component tests where possible and keep discovery, filtering,
and config wiring covered by pure tests.
