# Main Keyboard Long-Press Navigation Design

## Context

The mobile terminal keyboard already supports per-key `longPress.options` in the
runtime shell config. The `Review` key on `phone_base` uses this pattern: a tap
runs the primary action, while a long press opens a popup with related options.

The advanced keyboard currently exposes navigation keys that are useful from the
main keyboard:

- `PAGE_UP`
- `PAGE_DOWN`
- `Prev all`
- `Next all`
- `Alt-w`

The main keyboard currently has plain `ARROW_LEFT`, `ARROW_RIGHT`, and `Window`
keys with no long-press options.

## Goal

Add long-press navigation menus to the main keyboard so common advanced
navigation actions are available without switching keyboards.

## Non-Goals

- Do not change the long-press gesture implementation.
- Do not add new visible rows or keys.
- Do not change the advanced keyboard layout.
- Do not change action semantics, macro parsing, or keyboard routing.

## Design

Update only `apps/mobile/config/shell-config.json`.

On `phone_base`:

- `ARROW_LEFT`
  - Tap: send the existing left-arrow bytes.
  - Long press: show `ARROW_LEFT`, `PAGE_UP`, and `Prev all`.
- `ARROW_RIGHT`
  - Tap: send the existing right-arrow bytes.
  - Long press: show `ARROW_RIGHT`, `PAGE_DOWN`, and `Next all`.
- `Window`
  - Tap: send the existing window bytes.
  - Long press: show `Window`, `Prev all`, `Next all`, and `Alt-w`.

Each long-press option should reuse the same slot definitions already present in
the bundled config:

- `ARROW_LEFT`: bytes `[27, 91, 68]`, icon `ArrowLeft`
- `ARROW_RIGHT`: bytes `[27, 91, 67]`, icon `ArrowRight`
- `PAGE_UP`: bytes `[27, 91, 53, 126]`, icon `ChevronsUp`
- `PAGE_DOWN`: bytes `[27, 91, 54, 126]`, icon `ChevronsDown`
- `Prev all`: bytes `[2, 112]`
- `Next all`: bytes `[2, 110]`
- `Alt-w`: macro `alt_w`

The primary key definitions remain unchanged except for the added
`longPress.options` objects.

## Components

- `apps/mobile/config/shell-config.json`: add the three long-press menus and
  bump `version`/`updatedAt`.
- `apps/mobile/test/integration/keyboard-config.test.ts`: add assertions for
  the three new long-press menus.

## Data Flow

1. User taps `ARROW_LEFT`, `ARROW_RIGHT`, or `Window`.
2. The existing primary slot runs as before.
3. User long-presses one of those keys.
4. The existing long-press popup opens with the configured options.
5. User releases on an option.
6. The chosen configured slot runs through the existing keyboard runtime.

## Error Handling

No new error handling is needed. Existing shell config validation already checks
that long-press options are valid keyboard executable items and that referenced
macros exist for the keyboard.

## Testing

Run:

```sh
pnpm --filter @fressh/mobile validate:shell-config
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-config-schema.test.ts test/integration/keyboard-config.test.ts
```

After pushing to `dev`, reload config in the app from the Configure modal.
