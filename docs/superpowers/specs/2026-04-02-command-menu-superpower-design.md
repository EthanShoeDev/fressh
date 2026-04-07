# Command Menu Superpower Submenu Design

## Goal

Add a `superpower` submenu to the mobile shell command menu so users can
quickly insert skill triggers for common superpowers.

## Scope

This change is limited to the command preset data used by the shell command
menu in the mobile app.

## Behavior

- Add a new root submenu labeled `superpower`.
- Populate it with these preset items, in this order:
  - `$test-driven-development`
  - `$systematic-debugging`
  - `$verification-before-completion`
  - `$brainstorming`
  - `$writing-plans`
  - `$executing-plans`
  - `$dispatching-parallel-agents`
  - `$requesting-code-review`
  - `$receiving-code-review`
  - `$finishing-a-development-branch`
  - `$writing-skills`
  - `$using-superpowers`
- Selecting any of these items should only type the `$skill-name` text into the
  terminal input.
- Selecting any of these items must not send Enter automatically.

## Implementation Notes

- Reuse the existing `submenu` and `preset` data model in
  `apps/mobile/src/lib/command-presets.ts`.
- Represent each superpower item as a single `text` step with no `enter` step.
- Leave the modal UI and keyboard runtime unchanged because they already
  support nested menus and text-only preset insertion.

## Testing

- Add an integration test that verifies the `superpower` submenu exists.
- Verify the submenu contains the expected labels in the expected order.
- Verify every submenu item inserts only its own `$skill-name` text and does
  not include an Enter step.
