# Persistent Advanced Keyboard Design

## Context

The mobile terminal keyboard supports multiple configured keyboard layouts. The
bundled `advanced_keyboard` is currently routed as a one-shot layout through
`keyboardRouting.oneShotReturnByKeyboardId`, so ordinary key presses return the
selected keyboard to `phone_base`.

This conflicts with the desired behavior: after opening the advanced keyboard,
tapping advanced keys should keep the advanced keyboard visible. The only exit
path should be the explicit `Back` key on the advanced keyboard, which already
uses `OPEN_MAIN_MENU`.

## Goal

Make the bundled advanced keyboard persistent after key presses.

## Non-Goals

- Do not redesign the keyboard switching state machine.
- Do not add new UI controls.
- Do not change long-press, repeat, modifier, or selection behavior.
- Do not change remote/runtime config semantics beyond the bundled config value.

## Design

Remove the bundled `advanced_keyboard` entry from
`keyboardRouting.oneShotReturnByKeyboardId`. With no one-shot return configured,
`resolveActiveOneShotReturnKeyboardId` returns `null` for `advanced_keyboard`,
and `handleSlotPress` leaves the selected keyboard unchanged after normal slot
execution.

Keep `keyboardRouting.actionTargets.OPEN_MAIN_MENU` routed to `phone_base`.
The advanced keyboard's `Back` key uses that action, so it remains the explicit
exit from the advanced keyboard.

## Components

- `apps/mobile/config/shell-config.json`: remove the one-shot return mapping
  for `advanced_keyboard`.
- `apps/mobile/test/integration/shell-config-schema.test.ts`: update bundled
  config expectations so the empty one-shot map is intentional.
- `apps/mobile/test/integration/keyboard-routing.test.ts`: cover the bundled
  advanced keyboard route:
  - `advanced_keyboard` resolves no one-shot return target.
  - `OPEN_MAIN_MENU` still resolves to `phone_base`.

## Data Flow

1. User taps `Advanced` on `phone_base`.
2. `OPEN_ADVANCED_KEYBOARD` selects `advanced_keyboard`.
3. User taps any ordinary advanced key.
4. The slot executes normally.
5. The one-shot return lookup returns `null`, so the selected keyboard remains
   `advanced_keyboard`.
6. User taps `Back`.
7. `OPEN_MAIN_MENU` selects `phone_base`.

## Error Handling

No new error handling is needed. Existing config validation already accepts an
empty `oneShotReturnByKeyboardId` map and validates action target routes.

## Testing

Run the focused mobile integration tests that cover shell config and keyboard
routing:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/shell-config-schema.test.ts test/integration/keyboard-routing.test.ts
```
