# Scrollback Live Input Guard Design

## Problem

On Android tablet builds, touch scrolling enters tmux copy/scrollback mode so
the user can review terminal history. If the user then opens the plain Text
entry modal, types text, and presses Paste, the modal closes but the text is
sometimes not delivered to the live terminal prompt.

The expected behavior is consistent: Paste from the Text modal should leave
scrollback/history mode, send the typed text, and press Enter. The same
scrollback exit guarantee should apply to other user-originated terminal input
so keyboard buttons, clipboard paste, commander input, command presets, and
macros do not each rely on separate scrollback handling.

## Goals

- Centralize "ensure live terminal before sending user input" behavior.
- Preserve current per-feature payload semantics.
- Keep sends ordered so the scrollback exit reaches tmux before user input.
- Fail closed when scrollback is active and the configured cancel key is not
  safe to send.
- Keep the implementation local to the mobile shell input path.

## Non-Goals

- Change touch-scroll gesture behavior.
- Change tmux copy-mode commands or key bindings.
- Add a new confirmation step or disable the Text modal Paste button.
- Change clipboard paste to submit Enter.
- Rework Wispr automation.

## Architecture

`apps/mobile/src/app/shell/detail.tsx` should expose one shared live-input send
path used by all user-originated terminal input. This should replace the
current mix of direct `sendBytesOrdered`, `sendBytesQueued`, and ad hoc
scrollback handling in UI callbacks.

The shared helper should accept one or more byte segments and options for
ordered batching. It should check `scrollbackActiveRef.current` at send time.
If scrollback is inactive, it sends the payload through the existing ordered
writer. If scrollback is active, it validates the tmux cancel key, exits local
and WebView scrollback state, sends the cancel key first, then sends the
payload in order.

Callers should keep their existing intent-specific behavior:

- keyboard text and byte keys send their configured payload;
- clipboard paste sends clipboard text only;
- Text modal Paste sends text followed by Enter;
- commander Execute sends command text followed by Enter;
- commander Paste Text sends text only;
- command presets and macros send their configured steps.

## Data Flow

1. A UI action produces terminal input as bytes or byte segments.
2. The UI action calls the shared live-input helper.
3. The helper checks the current scrollback state.
4. If scrollback is inactive, it sends the payload normally.
5. If scrollback is active, it sends the tmux cancel key before the payload.
6. The helper clears local scrollback state and asks the WebView scrollback
   controller to exit so the UI no longer shows history mode.
7. For multi-part actions such as text plus Enter, the helper keeps the
   segments in one ordered operation so Enter cannot separate from the text.

## Error Handling

When scrollback is active and the cancel key is invalid, the helper should log a
warning and block the payload. This prevents user text from being injected into
tmux copy mode.

If the underlying shell send fails, the existing lower-level send behavior
should continue to handle logging and navigation. The helper should not add a
new user-facing alert unless the app already has an established terminal-send
error surface for this case.

The helper may clear local scrollback state before tmux has fully processed the
cancel key. Ordered send sequencing and the existing inter-segment delay are the
guardrails that keep the payload behind the exit request.

## Testing

Add focused unit tests around the extracted scrollback input sequencing decision
if the implementation moves that logic into `apps/mobile/src/lib/tmux-scrollback.ts`
or a nearby helper. Cover these cases:

- inactive scrollback sends only the payload;
- active scrollback sends cancel first, then payload;
- active scrollback with multi-segment input preserves ordering;
- active scrollback with an invalid cancel key blocks the payload;
- Text modal Paste appends Enter;
- clipboard paste does not append Enter.

Manual Android preview verification:

- enter scrollback with touch scroll, tap Text, type, press Paste, and confirm
  the app exits history mode and submits the text;
- from scrollback, verify normal keyboard keys, clipboard paste, commander
  actions, command presets, and macros still send to the live prompt;
- verify normal live-mode input behavior is unchanged.
