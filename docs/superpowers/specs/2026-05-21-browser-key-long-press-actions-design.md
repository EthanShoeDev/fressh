# Browser Key Long-Press Actions Design

## Context

The mobile terminal keyboard is configured by
`apps/mobile/config/shell-config.json`. The active `phone_base` keyboard has a
top-row `Browser` key. Today that key is an action slot:

- short tap: `OPEN_BROWSER_KEYBOARD`
- long press: no options

The app already has a separate `browser_keyboard` with host browser actions:

- `OPEN_HOST_DIFFITY`
- `OPEN_HOST_URL_WINDOW`
- `OPEN_HOST_URL_DEV_SERVER`
- `OPEN_HOST_URL_STORYBOOK`
- `OPEN_HOST_URL_APP`

The `Browser` key keeps its current short-tap action behavior and also
offer a long-press popup for these browser actions.

## Goals

- Keep short tap on `Browser` as the existing `OPEN_BROWSER_KEYBOARD` app
  action.
- Add a long-press popup on `Browser` with browser-related app actions.
- Keep the change JSON-only in `apps/mobile/config/shell-config.json`.
- Preserve the existing `browser_keyboard` and keyboard routing.

## Non-Goals

- Do not make short tap send `Alt+w`.
- Do not use the existing `alt_w` macro for the `Browser` key.
- Do not add new action IDs or runtime behavior.
- Do not change schemas, generated files, or keyboard rendering code.

## Proposed Design

Modify only the `Browser` slot on the `phone_base` keyboard.

The slot remains:

```json
{
  "type": "action",
  "actionId": "OPEN_BROWSER_KEYBOARD",
  "label": "Browser",
  "icon": "ExternalLink"
}
```

Add `longPress.options` to that same action slot:

```json
"longPress": {
  "options": [
    {
      "type": "action",
      "actionId": "OPEN_BROWSER_KEYBOARD",
      "label": "Browser",
      "icon": "ExternalLink"
    },
    {
      "type": "action",
      "actionId": "OPEN_HOST_DIFFITY",
      "label": "Diff",
      "icon": "GitCompare"
    },
    {
      "type": "action",
      "actionId": "OPEN_HOST_URL_WINDOW",
      "label": "URL",
      "icon": "ExternalLink"
    },
    {
      "type": "action",
      "actionId": "OPEN_HOST_URL_DEV_SERVER",
      "label": "Web",
      "icon": "Globe"
    },
    {
      "type": "action",
      "actionId": "OPEN_HOST_URL_STORYBOOK",
      "label": "Story",
      "icon": "BookOpen"
    },
    {
      "type": "action",
      "actionId": "OPEN_HOST_URL_APP",
      "label": "App",
      "icon": "AppWindow"
    }
  ]
}
```

The first option duplicates the short-tap action so the long-press popup can
still explicitly open the browser keyboard. The remaining options mirror the
current `browser_keyboard` row.

## Data Flow

Short tap flow remains unchanged:

1. User taps `Browser`.
2. Keyboard runtime dispatches `OPEN_BROWSER_KEYBOARD`.
3. Keyboard routing selects `browser_keyboard`.

Long press flow:

1. User long-presses `Browser`.
2. Existing long-press UI displays the configured popup options.
3. User selects one action.
4. Existing keyboard action handling runs that action.

## Error Handling

No new error handling is needed. The long-press options use existing action IDs
that already route through the current keyboard action context.

## Testing

Validation includes:

- runtime shell config validation
- focused keyboard config/integration tests covering that the `Browser` key has
  long-press options
- existing long-press tests, if the touched assertions are relevant

The runtime config metadata is bumped when the JSON changes are made.
