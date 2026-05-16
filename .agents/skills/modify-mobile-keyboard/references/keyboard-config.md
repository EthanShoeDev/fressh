# Keyboard Config Reference

## Slot Shapes

Keyboard cells are entries in `keyboards[].grid`. A cell can be `null` or one of
these objects:

```json
{ "type": "text", "text": "ls", "label": "ls", "icon": null }
{ "type": "bytes", "bytes": [27], "label": "ESC", "icon": "X" }
{ "type": "modifier", "modifier": "CTRL", "label": "Ctrl", "icon": null }
{ "type": "macro", "macroId": "review", "label": "Review", "icon": null }
{ "type": "action", "actionId": "PASTE_CLIPBOARD", "label": "Paste", "icon": "ClipboardPaste" }
```

Slots may include `"span": 2` or a `longPress` object.

## Long Press

Long-press options can be `text`, `bytes`, `macro`, or `action`.

```json
"longPress": {
  "options": [
    { "type": "macro", "macroId": "review_2", "label": "Review 2", "icon": null },
    { "type": "macro", "macroId": "review_3", "label": "Review 3", "icon": null }
  ]
}
```

Options do not take `span`.

## Macros

Macros live in `macrosByKeyboardId[<keyboardId>]`.

```json
{
  "id": "example",
  "name": "example",
  "label": "Example",
  "category": "custom",
  "script": "{\"type\":\"command\",\"value\":\"pwd\",\"enter\":true}"
}
```

Supported macro script payloads:

- `{"type":"command","value":"cmd","enter":true}` sends text and Enter by
  default.
- `{"type":"text","value":"text","enter":false}` sends text; Enter defaults
  false.
- `{"type":"sequence","value":"..."}` sends a raw sequence string.
- `{"type":"steps","steps":[...]}` supports `text`, `enter`, `arrowDown`,
  `arrowUp`, `esc`, `space`, and `tab` steps. Steps can include `delayMs` and
  positive integer `repeat`.
- `{"type":"action","actionId":"PASTE_CLIPBOARD"}` runs an existing action.

## Actions

Current action IDs are defined in `apps/mobile/src/lib/keyboard-actions.ts`.
Use only existing actions for JSON-only work.

Known useful actions:

- `OPEN_ADVANCED_KEYBOARD`
- `OPEN_MAIN_MENU`
- `ROTATE_KEYBOARD`
- `PASTE_CLIPBOARD`
- `COPY_SELECTION`
- `TOGGLE_COMMAND_PRESETS`
- `OPEN_COMMANDER`
- `OPEN_WISPR_TEXT_EDITOR`
- `CYCLE_TMUX_WINDOW`

Only target actions listed in `KEYBOARD_TARGET_ACTION_IDS` can appear in
`keyboardRouting.actionTargets`.

## Common Bytes

- Escape: `[27]`
- Ctrl+C: `[3]`
- Ctrl+D: `[4]`
- Ctrl+Z: `[26]`
- Enter: `[13]`
- Tab: `[9]`
- Backspace: `[127]`
- Tmux prefix `Ctrl+B`: `[2]`
- Tmux previous window `Ctrl+B p`: `[2, 112]`
- Tmux next window `Ctrl+B n`: `[2, 110]`
- Up arrow: `[27, 91, 65]`
- Down arrow: `[27, 91, 66]`
- Right arrow: `[27, 91, 67]`
- Left arrow: `[27, 91, 68]`

## Routing

`defaultKeyboardId` must be listed in `activeKeyboardIds`.
Every active keyboard must exist in `keyboards`.

`keyboardRouting.actionTargets` maps navigation actions to active keyboard IDs:

```json
"keyboardRouting": {
  "actionTargets": {
    "OPEN_ADVANCED_KEYBOARD": "advanced_keyboard",
    "OPEN_MAIN_MENU": "phone_base"
  },
  "oneShotReturnByKeyboardId": {}
}
```

Use `oneShotReturnByKeyboardId` only when a keyboard should return to another
keyboard after a key press or copy action.

## Publishing to Device

For runtime config changes:

1. Commit the JSON change on `dev`.
2. Push `dev`.
3. On the device, open the shell Configure modal.
4. Tap `Reload config`.

Use EAS OTA only for JS/assets changes outside this runtime config path.
