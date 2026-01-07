# Android Tablet Touch Scrolling (Tmux Copy-Mode)

**Status:** Draft design (implementation-ready, v5.1)
**Related:** [mobile-scrolling-terminal.md](./mobile-scrolling-terminal.md), [tmux-scrollback-implementation.md](./tmux-scrollback-implementation.md)

## Summary

Implement **native-feeling finger-drag scrolling** in tmux on **Android tablets** by translating touch gestures into **tmux copy-mode** key sequences. The WebView intercepts touch events, enters copy‑mode on drag, emits Up/Down (or PgUp/PgDn) keys as the user moves, and **keeps copy‑mode active** so the user can read scrollback. Copy‑mode exits only on an explicit action (e.g. typing or a “Jump to live” affordance). This provides a natural scroll experience without altering tmux config or disabling alternate screen.

## Goals

- One‑finger drag on the terminal scrolls tmux history (copy-mode) on Android tablets.
- Prevent WebView or xterm.js from performing native scroll (no “double scroll”).
- Preserve long‑press selection and existing selection overlay behavior.
- Work for existing tmux sessions without requiring user tmux config changes.
- Keep latency tolerable by coalescing and rate‑limiting scroll events.

## Non‑Goals

- iOS support in this iteration.
- Perfect pixel‑level sync between finger movement and rendered scroll.
- Multi‑pane awareness or “scroll only one pane” selection UX.
- tmux control mode or capture‑pane scrollback (see related designs).

## Constraints & Assumptions

- Android tablet devices only (enable by screen size heuristic).
- Tmux is active (connection uses `useTmux: true`).
- Default tmux prefix is `Ctrl+B` unless user overrides in settings.
- Copy‑mode cancel is **typically `q`** in tmux defaults, but users can rebind copy‑mode tables. Treat `exitKey` as configurable; default to `q`.
- Injecting `Esc` is problematic when followed by arbitrary bytes (escape-time and escape-sequence ambiguity). Prefer `q` as the **default injected cancel key**, but allow override because users can rebind copy-mode tables.
- `C-c` can also cancel in many setups but is **riskier if it leaks** (it can interrupt running programs). Prefer `q`; allow override but discourage `C-c` as the default.
- Validate `cancelKey` at runtime: it must be **one byte** and **not Esc** for auto‑exit + payload. If invalid, **disable auto‑exit + payload** and require explicit “Jump to live” (or a recovery exit) before sending input.
- Prefix mismatch will cause scroll gestures to inject keys without entering copy‑mode; mitigate by exposing a per‑connection prefix setting (MVP).

## Architecture Overview

```
Touch gesture (WebView)
   ↓
TouchScrollController (xterm.js page)
   ↓ (send input sequences)
Bridge: { type: 'input', str: "\x02[..." }
   ↓
React Native (detail.tsx onData)
   ↓
Rust SSH PTY → tmux attach → copy-mode scroll
```

### Why copy‑mode
- Tmux owns scrollback when attached; xterm.js scrollback is not authoritative.
- Copy‑mode is a supported tmux mechanism with stable keybindings.

## Gesture → Key Mapping

**Base sequences** (xterm style):
- Enter copy‑mode: `Ctrl+B` then `[` → `\x02[`
- Up arrow: `\x1b[A`
- Down arrow: `\x1b[B`
- Page Up: `\x1b[5~`
- Page Down: `\x1b[6~`
- Exit copy‑mode: typically `q` (configurable)

**Recovery exit sequence** (use only when state is uncertain):
- `prefixKey + copyModeKey + cancelKey` so tmux consumes the exit even if copy‑mode wasn’t active yet.
- When already in ScrollbackActive, prefer a **single cancel key** (no prefix) to avoid assume‑paste‑time and escape‑time issues.

**Mapping rules (direct manipulation)**:
- **Finger moves down** (`dy > 0`) → reveal **older** content: send Up or PgUp
- **Finger moves up** (`dy < 0`) → reveal **newer** content: send Down or PgDn
- **Small deltas** → line scroll (arrow keys)
- **Fast flick** → page scroll (PgUp/PgDn) + residual line scroll
Use `invertScroll` to flip direction if testing shows the device feels “reversed”.

## Immediate Scroll Compensation (Cursor Edge Anchoring)

### Problem
In tmux copy‑mode, the cursor starts on the **bottom line** of the viewport. Arrow keys (`Up`/`Down`) first move the **cursor within the visible page** before the viewport itself scrolls. On touch devices this feels laggy:

- **First drag**: user expects content to move immediately, but must scroll a full page before the viewport starts moving.
- **Direction change**: after scrolling up, reversing direction requires the cursor to traverse the whole screen before the viewport follows.

This creates a “dead zone” that feels unlike native mobile scrolling.

### Goal
Make the **viewport move immediately** on the first drag and whenever the user reverses direction, while keeping line‑by‑line control and without requiring tmux config changes.

### Approach: Anchor the Cursor at the Viewport Edge
Before emitting scroll keys in a given direction, **move the copy‑mode cursor to the edge that makes scrolling immediate**:

- **Scrolling up (older)** → move cursor to **top line**
- **Scrolling down (newer)** → move cursor to **bottom line**

With the cursor pinned to the edge, the next `Up`/`Down` arrow scrolls the viewport immediately instead of just moving the cursor inside the page.

### Key bindings (defaults + configurability)
Use copy‑mode keys that move the cursor to the edge:

- **Default (vi table):**
  - `anchorUpKey = 'H'` (top of screen)
  - `anchorDownKey = 'L'` (bottom of screen)
- **Emacs users:** set custom keys (e.g. `M-<` / `M->`) via config if needed.

These anchor keys are **sent only inside copy‑mode**, and they are **not** combined with payload input, so `Esc` sequences are acceptable here if a user configures them.

If anchor keys are **unset**, fall back to the current behavior (no compensation).

### Direction change logic
Track the **last scroll direction** (`up | down | null`).

On each flush:
1. Determine current direction from `pendingLines`.
2. If direction is **new or changed**, emit the corresponding anchor key **once**.
3. Emit line/page scroll keys as normal.

This makes the viewport respond immediately on:
- **First scroll after entering copy‑mode**
- **Each direction reversal**

### Timing & ordering
- Anchor keys **must only be sent after `copyModeState === 'on'`**.
- Anchor keys and subsequent scroll keys go through the **single writer queue** to maintain order.
- If `copyModeState === 'entering'`, accumulate deltas and anchor once entry completes.

### Configuration (new optional fields)
Add optional fields to `TouchScrollConfig`:

```
anchorUpKey?: string;   // default 'H' (vi top-of-screen)
anchorDownKey?: string; // default 'L' (vi bottom-of-screen)
anchorOnDirectionChange?: boolean; // default true
```

### Pseudocode (controller flush)
```
if (copyModeState !== 'on') return;
if (!pendingLines) return;

const dir = pendingLines > 0 ? 'up' : 'down';
if (anchorOnDirectionChange && dir !== lastDir) {
  send(anchorKeyFor(dir));
  lastDir = dir;
}

emitScrollSteps(dir, pendingLines);
```

### Trade‑offs
- Assumes default **vi copy‑mode** keys for anchors (`H`/`L`). Emacs users should override.
- If a user rebinds these keys to something else, anchors may misbehave; they can disable or override per connection.

## TouchScrollController Design

### State Machine

```
Idle
  └─ pointerdown → Tracking (startPoint, time)
      ├─ move < slop → Tracking
      ├─ move ≥ slop → Scrolling (enter copy‑mode once)
      └─ long-press → SelectionMode (existing behavior)

Scrolling
  ├─ pointermove → emit scroll steps (rate‑limited)
  ├─ pointerup → ScrollbackActive (stay in copy‑mode)
  └─ pointercancel → ScrollbackActive

ScrollbackActive (copy‑mode engaged; no pointer down)
  ├─ pointerdown → Tracking (continue scrolling)
  ├─ keyboard input → exit copy‑mode once, then forward input
  └─ explicit “Jump to live” action → exit copy‑mode
```

When returning from ScrollbackActive to Tracking/Scrolling, **do not re‑enter copy‑mode**; keep `copyModeEngaged` true and only emit arrow/PgUp/PgDn.
If using `scrollbackModeChanged.phase`, emit `phase:'active'` on the pointerup transition to ScrollbackActive.

Copy‑mode entry is **two‑phase** when `prefixKey` and `copyModeKey` are split:
`copyModeState: 'off' | 'entering' | 'on'`. While **entering**, accumulate scroll deltas but **do not emit** arrow/Pg keys until the `copyModeKey` has been sent.
On transition into `entering` (slop exceeded), **immediately emit** `scrollbackModeChanged(active:true, phase:'dragging')` so RN gates inputs even before entry completes.

`copyModeConfidence` becomes **confident** only after copy‑mode entry completes **and the first scroll key is emitted** (arrow/PgUp/PgDn). It becomes **uncertain** after WebView reload, config disable, any forced recovery exit, or a config change while active (prefix/copyMode/cancelKey). Use it to decide whether to send a single `cancelKey` vs the recovery sequence.

Pointer transitions:
- `pointerdown`: set `pointerIsDown = true`. If `copyModeState === 'entering'`, clear `pendingPointerUp = false`.
- `pointerup` while `copyModeState === 'entering'`: set `pendingPointerUp = true` so entry completes with `phase:'active'` **only if the finger is still up** when the timer fires.

### Thresholds & Tuning (defaults)

- **slopPx**: 8–12px (start scroll only after a small move)
- **pxPerLine**: ~16px (one line per 16px of drag)
- **maxLinesPerFrame**: 6 (avoid flooding)
- **flickVelocity**: > 1.2 px/ms triggers PgUp/PgDn
- **remainderPx**: keep fractional remainder so slow drags don’t feel “sticky”.
- **enterDelayMs**: 10ms between `prefixKey` and `copyModeKey` (tweakable).
Prefer rate limiting via a single `requestAnimationFrame` flush that emits up to `maxLinesPerFrame`.
Define `pageStepLines = Math.max(10, term.rows - 1)` for PgUp/PgDn handling.
Clamp `dt` (e.g. `dt = Math.max(dt, 8)`) to avoid noisy velocity spikes.
Flush once on `pointerup` to apply any remaining pendingLines before entering ScrollbackActive.
Cap `pendingLines` to ±(3–5 pages) to avoid “scroll keeps going after I stopped”.

tmux note: `assume-paste-time` can suppress key bindings if keys arrive too fast. Mitigations:
- Send `prefixKey` and `copyModeKey` as **separate sends** (tiny delay is fine).
- Do **not** emit arrow/Pg keys until `copyModeKey` has been sent (gate on `copyModeState === 'on'`).
- Avoid large `key.repeat(count)` bursts; prefer smaller batches (1–2 arrows) and PgUp/PgDn for fast movement.
- If you must send the **recovery exit sequence** (`prefix + [` + cancelKey), send it in ordered chunks (not a single burst) and only then send any payload.

### Computing Line Height

Prefer layout‑derived value to avoid hard‑coded font size:

```
lineHeightPx = term.element.clientHeight / term.rows
pxPerLine = max(12, lineHeightPx)
```

Avoid direct use of private xterm internals unless necessary.

### Preventing Native Scroll

On scroll tracking:
- Use **Pointer Events** with `pointerId` tracking and `setPointerCapture` **after slop**.
- Only call `preventDefault()` / `stopPropagation()` **after** slop is exceeded.
- Set `touch-action: none` on the terminal container **when the feature is enabled** (so the current gesture isn’t treated as a pan by WebView).
- Ignore secondary pointers (`event.isPrimary === false`) to avoid multi‑touch conflicts.

If Touch Events are used as a fallback, register `touchmove` with `{ passive: false }` so `preventDefault()` works on Android WebView.

This blocks WebView and xterm.js from moving their own scrollback.

## Integration Points (Files)

### 1) WebView Bridge Types
**File:** `packages/react-native-xtermjs-webview/src/bridge.ts`

Add outbound config:

```ts
export type TouchScrollConfig = {
	enabled: boolean;
	pxPerLine?: number;
	slopPx?: number;
	maxLinesPerFrame?: number;
	flickVelocity?: number;
	invertScroll?: boolean; // optional: invert natural direction
	anchorUpKey?: string; // move cursor to top-of-screen before scrolling up (default 'H')
	anchorDownKey?: string; // move cursor to bottom-of-screen before scrolling down (default 'L')
	anchorOnDirectionChange?: boolean; // default true
	enterDelayMs?: number; // delay between prefixKey and copyModeKey (default 10)
	prefixKey?: string; // default "\x02"
	copyModeKey?: string; // default "["
	exitKey?: string; // user exit key (default "q")
	cancelKey?: string; // injected cancel key (default "q"; avoid "\x1b" for auto-exit)
	debug?: boolean;
};

export type BridgeOutboundMessage =
	| { type: 'setTouchScrollConfig'; config: TouchScrollConfig }
	| { type: 'exitScrollback'; emitExit?: boolean; requestId?: number } // emitExit=false when RN already sent cancelKey
	| ...existing;

export type BridgeInboundMessage =
	| { type: 'initialized'; instanceId: string }
	| { type: 'input'; str: string; instanceId: string }
	| { type: 'selectionChanged'; text: string; instanceId: string }
	| { type: 'selection'; requestId: number; text: string; instanceId: string }
	| {
			type: 'scrollbackModeChanged';
			active: boolean;
			phase?: 'dragging' | 'active';
			instanceId: string;
			requestId?: number;
	  }
	| ...existing;
```

`scrollbackModeChanged` lets RN coordinate *all* input sources (on‑screen keyboard, paste, presets). Use `phase:'active'` (finger up) to control pill visibility.
If `phase` is omitted, emit `active:true` only on pointerup (ScrollbackActive).
`instanceId` on `initialized` and `input` prevents stale WebView messages from affecting current sessions.

### 2) WebView Controller Implementation
**File:** `packages/react-native-xtermjs-webview/src-internal/main.tsx`

Add `TouchScrollController` that:
- Installs `pointerdown/pointermove/pointerup/pointercancel` handlers on the terminal root.
- Uses config to enable/disable and tune behavior.
- Sends scroll sequences by calling `sendToRn({ type: 'input', str, instanceId })`.
- Respects `selectionModeEnabled` and exits early when selection mode is on.
- When `scrollbackActive` and the user types, sends the **cancelKey** once before forwarding the input (except when the input is the exitKey itself).
- Cancels any pending scroll flushes before exiting.
- Emits `scrollbackModeChanged` when entering/exiting (for RN UI + input coordination), including a WebView `instanceId`.
  - Emit `phase:'dragging'` when copy‑mode is first engaged (slop exceeded).
  - Emit `phase:'active'` on pointerup when entering ScrollbackActive.
- `exitScrollback` behavior:
  - `emitExit: true` (default): send **cancelKey** if copy‑mode is engaged; otherwise use the recovery exit sequence (split into ordered chunks), then clear state.
  - `emitExit: false`: clear pending scroll + state **only** (RN already sent exit bytes); cancel rAF flush, reset `pendingLines`/`remainderPx`, and release pointer capture if held.
  - If `requestId` is provided, echo it back on `scrollbackModeChanged(active:false)` so RN can await if needed.
  - `exitScrollback(emitExit:true)` may be called even if state is stale; the recovery exit sequence is **best‑effort** and may cause minor movement if already in copy‑mode.
- Exposes an `exitScrollback` handler that:
  - cancels pending scroll flushes,
  - exits copy‑mode using cancelKey or the recovery sequence,
  - clears internal state,
  - emits `scrollbackModeChanged(false)`.

Pseudocode:

```ts
let touchConfig = { enabled: false, pxPerLine: 16, slopPx: 8, ... };
type ScrollState = 'Idle' | 'Tracking' | 'Scrolling' | 'ScrollbackActive';
type CopyModeState = 'off' | 'entering' | 'on';
let state: ScrollState = 'Idle';
let copyModeState: CopyModeState = 'off';
let copyModeEngaged = false;
let copyModeConfidence: 'uncertain' | 'confident' = 'uncertain';
let enterTimer: number | null = null;
const instanceId = Math.random().toString(36).slice(2);
let pointerIsDown = false;
let pendingPointerUp = false;

function ensureCopyMode() {
	if (copyModeState !== 'off') return;
	copyModeState = 'entering';
	const delayMs = touchConfig.enterDelayMs ?? 10;
	// Gate inputs immediately while entering.
	sendToRn({
		type: 'scrollbackModeChanged',
		active: true,
		phase: 'dragging',
		instanceId,
	});
	// NOTE: RN must enqueue prefixKey + copyModeKey as a single batch with no interleaving.
	sendToRn({ type: 'input', str: touchConfig.prefixKey, instanceId });
	enterTimer = window.setTimeout(() => {
		sendToRn({ type: 'input', str: touchConfig.copyModeKey, instanceId });
		copyModeState = 'on';
		copyModeEngaged = true;
		if (!pointerIsDown) {
			sendToRn({
				type: 'scrollbackModeChanged',
				active: true,
				phase: 'active',
				instanceId,
			});
		}
		scheduleFlush(); // now safe to emit arrows/Pg keys
		if (!pointerIsDown && pendingPointerUp) {
			// Pointer already lifted; finalize ScrollbackActive and flush once.
			state = 'ScrollbackActive';
			pendingPointerUp = false;
		}
	}, delayMs);
}

function exitCopyMode({ emitExit = true, recovery = false } = {}) {
	if (enterTimer) {
		clearTimeout(enterTimer);
		enterTimer = null;
	}
	cancelPendingScroll(); // clear rAF, pendingLines, remainderPx
	copyModeState = 'off';
	if (emitExit) {
		const delayMs = touchConfig.enterDelayMs ?? 10;
		const cancelKey = touchConfig.cancelKey ?? 'q';
		const exitKey = touchConfig.exitKey ?? 'q';
		if (copyModeEngaged && copyModeConfidence === 'confident' && !recovery) {
			// Single-key cancel when we believe copy-mode is active.
			sendToRn({ type: 'input', str: cancelKey, instanceId });
		} else {
		// Recovery exit sequence, sent in ordered chunks (no burst). Best-effort; may cause minor movement if already in copy-mode.
			sendToRn({ type: 'input', str: touchConfig.prefixKey, instanceId });
			window.setTimeout(() => {
				sendToRn({ type: 'input', str: touchConfig.copyModeKey, instanceId });
				window.setTimeout(() => {
					sendToRn({ type: 'input', str: cancelKey, instanceId });
				}, delayMs);
			}, delayMs);
		}
	}
	copyModeEngaged = false;
	copyModeConfidence = 'uncertain';
	state = 'Idle';
	sendToRn({ type: 'scrollbackModeChanged', active: false, instanceId });
}

function emitLines(deltaLines: number) {
	if (deltaLines === 0) return;
	ensureCopyMode();
	if (copyModeState !== 'on') return; // gate until copy-mode entered
	if (copyModeConfidence !== 'confident') {
		copyModeConfidence = 'confident';
	}
	// deltaLines > 0 means finger moved down (natural), scroll back (Up).
	const natural = touchConfig.invertScroll ? -1 : 1;
	const key = deltaLines * natural > 0 ? '\x1b[A' : '\x1b[B';
	const count = Math.min(Math.abs(deltaLines), touchConfig.maxLinesPerFrame);
	// Avoid huge repeats; emit small batches if tmux assume-paste-time is sensitive.
	sendToRn({ type: 'input', str: key.repeat(count), instanceId });
}

// When the user types while scrollbackActive:
// If input matches exitKey/Esc: send exitKey only, mark inactive (no forward).
// Otherwise: exitCopyMode(); then send the original input data.
```

### Rate limiting + flick rule (explicit)

Suggested algorithm:

```
onPointerMove:
  accumulate dy into remainderPx
  convert to pendingLines = trunc(remainderPx / pxPerLine)
  remainderPx -= pendingLines * pxPerLine
  ensureCopyMode()
  if copyModeState !== 'on': return // wait for copy-mode entry before emitting
  if |velocity| >= flickVelocity && |pendingLines| >= 4:
    send one PgUp/PgDn immediately
    set copyModeConfidence = 'confident'
    pendingLines = pendingLines % pageStepLines
  schedule rAF flush if not scheduled

onFlush (rAF):
  if copyModeState !== 'on': return
  emit up to maxLinesPerFrame via arrows (prefer small batches to avoid assume-paste-time)
  set copyModeConfidence = 'confident' once a scroll key is emitted
  keep any remaining pendingLines for next frame
```

### 3) React Native Prop Surface
**File:** `packages/react-native-xtermjs-webview/src/index.tsx`

Add prop:

```ts
export type XtermJsWebViewProps = {
	// ...existing
	touchScrollConfig?: TouchScrollConfig;
	onScrollbackModeChange?: (event: {
		active: boolean;
		phase?: 'dragging' | 'active';
		instanceId: string;
		requestId?: number;
	}) => void;
};
```

On mount / config change, send `setTouchScrollConfig` to WebView.
Send only after `{ type: 'initialized' }` has been received.

Add imperative handle for exit:

```ts
export type XtermWebViewHandle = {
  // ...existing
  exitScrollback: (opts?: { emitExit?: boolean; requestId?: number }) => void;
};
```

### 4) Mobile Integration
**File:** `apps/mobile/src/app/shell/detail.tsx`

- Compute `isTablet` via screen size heuristic (e.g. `min(width, height) >= 600`).
- Enable touch scroll only on Android tablets and tmux sessions:

```ts
const shouldEnableTouchScroll = Platform.OS === 'android' && isTablet && useTmux;
```

Pass config:

```tsx
<XtermJsWebView
  // ...existing
  touchScrollConfig={{
    enabled: shouldEnableTouchScroll,
    pxPerLine: 16,
    slopPx: 10,
    maxLinesPerFrame: 6,
    flickVelocity: 1.2,
    invertScroll: false,
    enterDelayMs: 10,
    prefixKey: tmuxPrefixKey, // from connection settings (default '\x02')
    copyModeKey: '[',
    exitKey: tmuxCopyModeExitKey, // default 'q' unless user overrides
    cancelKey: tmuxCancelKey, // injected cancel key (default 'q')
    debug: false,
  }}
/>

Handle scrollback state + inputs:

- Store `currentInstanceId` from `{ type:'initialized', instanceId }`.
- Ignore **all** WebView messages (`input`, `scrollbackModeChanged`, selection) whose `instanceId` does not match `currentInstanceId`.
- Store `scrollbackActive` from `scrollbackModeChanged` (phase‑aware if provided).
- Treat `active:true` in **both phases** as “gate inputs through sendInputEnsuringLive”; show the pill only when `phase === 'active'`.
- Reset `scrollbackActive=false` on WebView `initialized` (new `instanceId`) and on reconnect.
- If `touchScrollConfig.enabled` flips to false while active, request `exitScrollback({ emitExit: true })`.
- Before any RN‑originated input (TerminalKeyboard, paste, presets, commander), if `scrollbackActive`:
  - RN sends **cancelKey** (single key) directly to SSH (ordering guarantee),
  - then sends the intended bytes/text (combine only if cancelKey is a single non-Esc byte),
  - then calls `exitScrollback({ emitExit: false })` to clear WebView state/UI (no extra exit bytes).
  - Use the **recovery exit sequence** only when you are not confident copy-mode is active.
  - Optimistically set `scrollbackActiveRef.current = false` after initiating exit to avoid double‑cancel on back‑to‑back actions.

Ordering guarantee helper (recommended):

```
function sendInputEnsuringLive(bytes: Uint8Array) {
  if (scrollbackActiveRef.current) {
    if (!isValidCancelKey(cancelKeyBytes)) {
      // Auto-exit disabled; require explicit Jump to live before accepting input.
      showJumpToLiveHint();
      return;
    }
    if (isExactExitKey(bytes, exitKey)) {
      sendBytesRaw(exitKeyBytes);
      xtermRef.current?.exitScrollback({ emitExit: false });
      return;
    }
    const isLargePayload =
      bytes.length > 32 ||
      bytes.includes(0x0a) || // \n
      bytes.includes(0x0d) || // \r
      containsBracketedPaste(bytes); // \x1b[200~
    // Combine only if cancelKey is a single non-Esc byte and payload is small.
    if (canCombineCancelKey(cancelKeyBytes, bytes) && !isLargePayload) {
      sendBytesRaw(concatBytes(cancelKeyBytes, bytes));
    } else {
      // Ordered queue or small delay to avoid assume-paste-time / escape-time issues.
      sendBytesQueued([cancelKeyBytes, bytes]);
    }
    xtermRef.current?.exitScrollback({ emitExit: false });
    return;
  }
  sendBytesRaw(bytes);
}
```

Notes:
- `cancelKeyBytes` should be a single non-Esc byte to allow safe concatenation.
- If `cancelKey` is invalid (multi‑byte or Esc), **skip auto‑exit + payload** and require explicit “Jump to live” before sending input.
- `containsBracketedPaste(bytes)` should detect bracketed paste markers (e.g. `\x1b[200~` **or** `\x1b[201~`) and force the “large payload” path.
- `sendBytesQueued` is a per-connection ordered queue (or small-delay sequencer) used when concatenation is unsafe.
  - Guarantees **no interleaving** with other writes while draining.
  - Supports an **optional delay** between segments (>= `enterDelayMs`).
  - Treats large payloads as a single segment even if chunked internally.
  - **All PTY writes** (RN and WebView forwarded) must go through the same writer/queue so queued segments cannot be interleaved by “raw” writes.

## Selection Mode Interactions

- If selection mode is active, **ignore** touch scrolling.
- If a long‑press is in progress and the user starts dragging beyond `slopPx`, **cancel long‑press** and start scroll.
- Selection mode does **not** exit copy‑mode; users can select text while scrolled up.

Implementation note: expose a `cancelLongPress()` hook from the long‑press handler (or consolidate into a single gesture manager) so scroll takeover reliably cancels the timer.

## Exit‑on‑typing Semantics

- Triggered for **user typing** (`term.onData`) and RN‑originated inputs (paste, presets, on‑screen keyboard).
- If the next input **equals the configured exit key** (`q` or `Esc`), send only the **exitKey** and mark scrollback inactive (avoid “exit then stray q”).
- Treat it as a match only for an **exact single-key payload** (`bytes.length === exitKey.length`).
- For `term.onData` (WebView‑originated): call `exitScrollback({ emitExit: true })`, then forward the input (unless it matched exitKey).
- For RN‑originated input: use `sendInputEnsuringLive` (RN sends cancelKey directly, then input).
- Auto‑exit uses `cancelKey` (not `exitKey`) to avoid `Esc` injection before arbitrary payloads.
- If `cancelKey` is invalid for auto‑exit (multi‑byte or Esc), **do not auto‑exit+forward**; require explicit “Jump to live” (or the user to press the configured `exitKey`) before accepting input.
- Optional: keep navigation keys (`\x1b[A`, `\x1b[B`, `\x1b[5~`, `\x1b[6~`) inside scrollback if hardware keyboard UX matters.

## Scrollback UI (Jump‑to‑Live)

MVP‑friendly affordance:
- When `scrollbackActive` is true, show a small overlay pill: **“Scrollback • Jump to live”**.
- Tapping it calls `exitScrollback()` (cancelKey if engaged; recovery sequence if not), clears pending scroll.
- Show the pill only in `ScrollbackActive` (finger up), not while actively dragging.
- Optional: single tap anywhere on terminal (no movement) can also exit, but only if it doesn’t interfere with long‑press selection.

If using `scrollbackModeChanged.phase`, show the pill only when `phase === 'active'`.

## Error Handling & Edge Cases

| Case | Behavior |
| --- | --- |
| Not in tmux | Touch scroll disabled by config. |
| Multi‑touch gesture | Ignore (no scroll). |
| Fast repeated drags | Reuse `scrollbackActive`; pointer capture ensures continuity. |
| Prefix mismatch | Scroll gestures inject keys; require prefix config or disable feature. |
| Cancel key unsafe | Prefer `q` (C‑c discouraged); if `cancelKey` is invalid, disable auto‑exit+payload and require explicit “Jump to live.” |
| Copy‑mode already active | Still send arrows; avoid re‑entering. |
| Full‑screen app inside tmux | Copy‑mode handles scroll; tmux remains source of truth. |
| Network latency spikes | Coalesce input, limit rate, avoid flooding. |

## UX Notes (Android Tablet)

- Scrolling should feel similar to a document view, but with **line‑based steps**.
- Keep velocity‑based page jumps conservative (tablet users prefer predictability).
- Provide a toggle in settings later if needed (not in MVP).

## Testing Plan

**Manual (device):**
- Drag up/down to scroll tmux history (tmux session active).
- Release finger → scrollback stays (copy‑mode remains active).
- Start typing → exits copy‑mode once, then input is delivered.
- Trigger paste / preset / on‑screen keyboard while in scrollback → exits copy‑mode once, then input is delivered.
- Short drags → line scroll; fast flicks → page scroll.
- Long‑press selection still works; selection handles appear and scroll is suppressed.
- Non‑tmux session: drag does not inject tmux keys.
- While keyboard is open: drag still scrolls and does not type characters.
- Fast flick + immediate finger up: no arrows before copy‑mode entry.
- Start drag (copyModeState=entering) then trigger RN paste/preset: cancel + payload go to live; pending scroll cleared.
- exitKey configured as Esc: exit still works; no Esc-prefixed payload issues.
- Large paste while in scrollback with default `assume-paste-time`: cancel still happens before paste.
- WebView reload mid‑scrollback: stale messages ignored; UI resets.

**Instrumentation:**
- Optional debug logs in WebView: start/stop scroll, emitted line counts.

## Appendix: Single Writer Queue (Required)

To guarantee **no interleaving** between cancel/payload and late scroll emissions, **all PTY writes must go through a single per‑connection writer/queue**, including:

- RN‑originated input (keyboard, paste, presets, commander).
- WebView‑originated `{ type:'input' }` (scroll arrows/PgUp/PgDn, recovery sequences).

**Rule:** if the queue is draining, “raw” writes must **enqueue as single segments** (not bypass the queue).

**Queue requirements (minimum):**
- Preserve **global ordering** across all writes.
- Support **batched segments** with an optional inter‑segment delay (>= `enterDelayMs`).
- Treat large payloads (paste/macro) as a **single segment** even if internally chunked.

**Atomic copy‑mode entry:** `prefixKey` → `copyModeKey` must be enqueued as a **single batched operation** (with `interSegmentDelayMs = enterDelayMs`) so **no other writes can interleave** between them. This prevents “paste while entering” from being interpreted as a prefixed tmux command.

## Rollout Plan

1. Land bridge + WebView controller (behind `touchScrollConfig.enabled`).
2. Add scrollback‑active behavior (no auto exit), `scrollbackModeChanged`, and exit‑on‑typing for *all* input paths.
3. Enable on Android tablets only for tmux sessions.
4. Tune thresholds and direction on device.

## Decisions & Follow‑ups

- **MVP:** add a per‑connection tmux prefix setting (default C‑b); auto‑detect can follow once an exec channel exists.
- **MVP:** add a per‑connection `exitKey` setting (default `q`) and `cancelKey` (default `q`) to handle custom copy‑mode bindings.
- **MVP:** add `cancelKey` (default `q`) for auto‑exit; avoid injecting `Esc` before arbitrary payloads.
- Consider two‑finger scrolling if selection conflicts persist.
- Optional: UI hint (“Scrollback • tap to live”) if discoverability is an issue.
- Optional: set xterm `scrollback: 0` while touch scroll is enabled to avoid confusing dual scroll paths.
