# Keyboard-Bounded Long-Press Lanes Design

## Context

The terminal keyboard supports long-press popup menus for alternate key actions.
Today, selecting an alternate option is too strict: the user has to move into or
near the popup row above the key. This is awkward on touch screens because the
natural drag path may stay on the original key or move below it.

The desired interaction is more forgiving without making accidental selections
far away from the keyboard.

## Goal

Make alternate-key selection work by horizontal option lanes anywhere vertically
inside the keyboard area.

## Non-Goals

- Do not change the keyboard config schema.
- Do not change which keys expose long-press menus.
- Do not change tap behavior before the long press fires.
- Do not select an option after the finger leaves the keyboard area entirely.

## Design

When a long-press popup is open:

- The selected option is determined by horizontal `x` position.
- `x` clamps to the nearest option lane, so dragging slightly left or right of
  the popup still selects the nearest option.
- Vertical `y` no longer has to be inside the popup row.
- Vertical `y` must remain inside the keyboard root's bounds.
- Releasing outside the keyboard root cancels the alternate selection.

The keyboard component already knows the keyboard root position. Extend the
long-press layout or release inputs with enough root-height information for the
pure hit-testing helper to decide whether `y` is still inside the keyboard.

## Components

- `apps/mobile/src/lib/keyboard-long-press.ts`
  - Add a pure helper for keyboard-bounded option-lane hit testing.
  - Use it for movement highlight and release selection.
- `apps/mobile/src/app/shell/components/TerminalKeyboard.tsx`
  - Track keyboard root height in addition to root position and width.
  - Pass keyboard-bounds data into the long-press helper.
- `apps/mobile/test/integration/keyboard-long-press.test.ts`
  - Cover selecting above the popup, on/below the original key, and cancelling
    outside the keyboard area.

## Data Flow

1. User long-presses a key.
2. Popup opens above the key.
3. User drags vertically above, on, or below the popup while staying within the
   keyboard root.
4. Highlight follows the horizontal option lane.
5. User releases inside the keyboard root.
6. The highlighted lane's option runs.
7. If the user releases outside the keyboard root, the gesture cancels.

## Error Handling

No new runtime error handling is needed. Missing popup layout still cancels, as
it does today.

## Testing

Run:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-long-press.test.ts
```

Before publishing, also run the relevant mobile integration tests:

```sh
pnpm --filter @fressh/mobile exec tsx --test test/integration/keyboard-long-press.test.ts test/integration/keyboard-config.test.ts
```
