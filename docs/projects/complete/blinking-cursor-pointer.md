# Future project: blinking cursor in the native terminal renderer

**Status:** IMPLEMENTED (full alacritty parity) — code complete, compiles for the
`aarch64-linux-android` target; **pending on-device visual verification** + a native
rebuild (and a `bun run ubrn:generate` since the uniffi `ShellOptions` record gained a
field — see "Implementation notes" below).
**Scope:** `@fressh/react-native-terminal` (`fressh-render` + the vendored alacritty
fork) + the mobile app's terminal settings. Android first (the live renderer); iOS
inherits it for free when that path lands.

## Implementation notes (as built)

The MVP→parity phasing below was collapsed into one pass at full parity. What shipped,
and where it deviates from the original plan:

- **Resolution (render plane, `driver.rs::cursor_blink_on`):**
  `cursor_blink.blinking_override().unwrap_or(term.cursor_style().blinking) &&
  mode.contains(SHOW_CURSOR)`, exactly as specced. Folded into `cursor_visible` in
  `content.rs` via a new `blink_on` param, so both cursor draw sites honour it.
- **Clock:** Rust `std::time::Instant` for the blink phase (`blink_epoch`), per the
  recommended option. No `frameTimeNanos` threading.
- **Config:** `CursorBlink { Never, Off, On, Always }` + `blink_interval_ms` (750) +
  `blink_timeout_s` (5; `0` = no timeout) on `TerminalConfig`. Timeout duration matches
  upstream `blink_timeout()`: `max(interval*2, timeout_s*1000)`.
- **`On` default-blink (the one cross-plane piece):** `term.cursor_style().blinking`
  defaults to `false`, so `On` (default-blink, program may steady it) is only honest if
  the `Term`'s `default_cursor_style.blinking` is seeded `true`. That seed is
  creation-time (control plane): plumbed `cursor_blink` through the uniffi `ShellOptions`
  record → `start_shell` → `ShellSession::spawn` → `TermConfig.default_cursor_style`,
  **mirroring `scrollback_lines`** (so, like scrollback, `On`/`Off` apply to *new*
  shells; `Never`/`Always`/interval/timeout apply live via the render config). Adding the
  record field means `bun run ubrn:generate` must be re-run (the field-add doesn't change
  the `start_shell` checksum, but the generated `shim_uniffi.ts` is gitignored and was
  hand-patched as a stopgap).
- **Activity reset — input only, NOT output (corrects the plan's v3):** re-reading
  upstream, `on_typing_start` resets blink on *input*/focus/config/cursor-style-escape,
  but plain PTY *output* does **not** reset it (the plan's "v3 reset on output" would have
  *diverged* from alacritty). So output is intentionally not a reset.
- **Where the input signal comes from:** the app sends keystrokes via the **control
  plane** (`shell.sendData` → `fressh_core::send_data`), not the render-plane
  `fressh_terminal_send_input` (which has no caller in this app). So the activity
  timestamp lives in `fressh-core`: `ShellSession.last_input_ms` (an `AtomicU64` of
  `now_ms()`), bumped in `send_data`, exposed as `shell_input_idle_ms(id)`. The shim's
  draw loop reads it each frame and passes `input_idle_ms` into `draw` → the renderer uses
  it for the timeout and detects a fresh keystroke as an idle *drop* between frames.
- **Focus / IME:** upstream also gates on window focus + IME preedit. Mobile has no
  equivalent in the renderer (a drawing view is effectively focused), so those gates are
  omitted.
- **Settings UI:** Never/Off/On/Always segmented control + a blink-interval stepper
  (100–2000 ms). Timeout is not exposed (defaults to 5 s).

The sections below are the original plan, kept for reference.

## Goal

Add a blinking text cursor, configurable from the app's Terminal settings, matching
alacritty's behaviour: a cursor that toggles visibility on a fixed interval, stops
blinking after an inactivity timeout, and honours the terminal's own blink escape
sequences. This finishes the "port alacritty's cursor settings" work — cursor *shape*
is already ported (`terminalCursorStyle` → Block/Beam/Underline/HollowBlock); cursor
*blink* is the missing piece.

> Note: this is unrelated to the GLES dual-source-blending limitation
> (`docs/gles-renderer-blend-limitation.md`). Blink is a time-based visibility toggle,
> not a blending feature — that doc explicitly calls this out.

## Why it's missing today

We vendored alacritty's **renderer library** (`alacritty_renderer`), not the alacritty
**binary**. In upstream alacritty the entire blink mechanism lives in the binary's
event loop, which we did not port:

- `alacritty/src/event.rs`
  - `update_cursor_blinking()` (~:1620) — resolves whether blinking is active right now.
  - `schedule_blinking()` (~:1652) — schedules a repeating `BlinkCursor` timer every
    `blink_interval` ms.
  - `schedule_blinking_timeout()` (~:1660) — schedules a one-shot to stop blinking
    after `blink_timeout`.
  - the `BlinkCursor` handler (~:1849) toggles `self.ctx.display.cursor_hidden ^= true`
    while `!cursor_blink_timed_out`.
  - `update_cursor_blinking` is also re-run on focus/config/activity (~:1202-1212).
- `alacritty/src/display/mod.rs` owns the `cursor_hidden: bool` flag the renderer reads.
- `alacritty/src/window_context.rs` fires `TerminalEvent::CursorBlinkingChange` on
  config/focus changes (~:229, :328).

Our stack has none of that. `fressh-render/src/content.rs` computes only the
terminal-mode visibility:

```rust
// content.rs (~:50)
let cursor_visible = cursor.shape != CursorShape::Hidden;   // DECTCEM only, never blink
```

So the cursor is always solid. We need our own small blink layer on top of this.

## What upstream's behaviour is (the spec to match)

- **Config** (`alacritty/src/config/cursor.rs`):
  - `cursor.style.blinking`: enum `CursorBlinking { Never, Off, On, Always }`
    (cursor.rs:116). `blinking_override()` (cursor.rs:125): `Never → Some(false)`,
    `Always → Some(true)`, `Off | On → None` (defer to the terminal).
  - `cursor.blink_interval`: `u64` ms, **default 750**, clamped to `MIN_BLINK_INTERVAL`.
  - `cursor.blink_timeout`: `u8` seconds, **default 5**; `0` = no timeout (falls back to
    a minimum number of cycles).
- **Resolution each frame** (`event.rs:update_cursor_blinking` ~:1630):
  ```
  blinking = config.blinking_override().unwrap_or(terminal.cursor_style().blinking)
  blinking &= terminal.mode().contains(TermMode::SHOW_CURSOR)   // (+ focus, + vi-mode upstream)
  ```
  `terminal.cursor_style().blinking` is driven by escape sequences — `CSI Ps SP q`
  (DECSCUSR) and `CSI ? 12 h/l` set it (`alacritty_terminal/src/term/mod.rs` ~:942,
  :1989, :2055). So a program that requests a blinking cursor gets one even if the user
  left the app default at "Off".
- **Toggle**: while active and not timed-out, flip visibility every `blink_interval`.
- **Timeout**: after `blink_timeout` of no activity, stop blinking and **leave the
  cursor visible** (`event.rs` ~:1647). Any key input / output resets the timer and
  re-shows the cursor (`event.rs:on_typing`/`:1202`).

## Our architecture & where to hook

Draw path (continuous — the Choreographer reposts every vsync, so a time-based blink
animates with no extra redraw plumbing):

```
HybridTerminal.kt doFrame(frameTimeNanos)  (~:106, reposts every frame)
  -> nativeDraw(handle)                     (~:133)
  -> cpp-adapter.cpp fressh_terminal_draw   (~:111)
  -> shim-uniffi/src/android.rs::fressh_terminal_draw
  -> AttachedTerminal.egl.draw_term(&term)
  -> fressh-render/src/driver.rs TerminalRenderer::draw(term)
  -> content.rs::renderable_cells(term, palette, bold_bright, cursor_style)
       + the non-block cursor rect in driver.rs (~:180)
```

Two cursor draw sites must respect a blink "hidden" state:
1. **Block cursor** — `content.rs` ~:107 (`is_cursor && cursor_style == Block` → cell
   inversion).
2. **Non-block cursor** — `content.rs` ~:55 builds `CursorRender`; drawn as a rect in
   `driver.rs` ~:180-202.

Cleanest seam: fold blink into the existing `cursor_visible` so both sites already
honour it — `cursor_visible = (cursor.shape != Hidden) && blink_on`.

## Implementation plan

### 1. Rust config (`fressh-render/src/config.rs`)
Add to `TerminalConfig`:
- `cursor_blink: CursorBlink` (new enum mirroring alacritty: `Never | Off | On | Always`).
- `blink_interval_ms: u64` (default 750).
- `blink_timeout_s: u64` (default 5; 0 = no timeout).
Add `CursorBlink::blinking_override() -> Option<bool>` (Never→false, Always→true,
Off/On→None) and a `from_wire(&str)` like `CursorStyle::from_wire`.

### 2. Blink state + computation (`fressh-render/src/driver.rs`)
`TerminalRenderer` gains blink state. Use a monotonic clock in Rust
(`std::time::Instant`; works on Android) — simplest, no JNI/C-ABI change. (Alternative:
thread `frameTimeNanos` through `nativeDraw`/`fressh_terminal_draw` for an
externally-supplied clock; only do this if `Instant` proves problematic.)
- `blink_epoch: Instant` — phase origin; reset on activity.
- `last_activity: Instant` — for the timeout.
In `draw()`, before building cells:
```
let term_blink = term.cursor_style().blinking;                 // escape-driven
let active = self.config.cursor_blink.blinking_override().unwrap_or(term_blink)
    && term.mode().contains(TermMode::SHOW_CURSOR);
let timed_out = blink_timeout_s != 0
    && last_activity.elapsed() >= Duration::from_secs(blink_timeout_s);
let blink_on = !active || timed_out
    || (blink_epoch.elapsed().as_millis() / interval_ms as u128) % 2 == 0;
```
Pass `blink_on` into `renderable_cells` (new param) and AND it with `cursor_visible`.

### 3. Activity reset
Blink must reset (cursor shown + `blink_epoch`/`last_activity` reset) on input/output.
Options, simplest first:
- **v1 (acceptable):** skip activity tracking; blink continuously at the interval when
  active, ignore timeout. Ship this first.
- **v2:** reset on **input** — hook `fressh_terminal_send_input` (android.rs) to bump
  `last_activity`/`blink_epoch` on the bound renderer.
- **v3 (full parity):** also reset on **output** — detect Term content change between
  frames (e.g. compare `term.renderable_content()` cursor point / a damage flag) and
  reset then. Upstream resets on the PTY-activity path.

### 4. Wire config (`shim-uniffi/src/android.rs`)
Extend `WireConfig` with `cursor_blink: String`, `blink_interval_ms`, `blink_timeout_s`;
fold into `TerminalConfig` in `build_config` (mirrors the existing `cursor_style` path
~:76, :100). Live updates already flow through `fressh_terminal_set_config`.

### 5. App settings (`apps/mobile`)
- `lib/preferences.*`: add `terminalCursorBlink` (and optionally interval/timeout)
  alongside `terminalCursorStyle`.
- `app/(tabs)/settings/terminal.tsx`: add a "Cursor blink" control next to the existing
  cursor-style picker (Never/Off/On/Always, or a simple on/off for v1).
- Plumb the values into the `<Terminal config={…}>` prop (same assembly as the other
  terminal settings) so they reach `WireConfig`.

## Suggested phasing

- **MVP:** config enum (treat as on/off) + interval, `Instant`-based blink in `draw()`,
  fold into `cursor_visible`, settings toggle. No timeout, no activity reset.
- **+ polish:** `blink_timeout` + reset on input (v2).
- **+ full parity:** reset on output (v3), honour `CSI Ps SP q` / `CSI ? 12 h/l`
  (already exposed via `term.cursor_style().blinking`), respect `SHOW_CURSOR`.

## Testing

- Inner loop: rebuild `.so` (`cargo ndk … -p shim-uniffi --release`) + `gradlew
  installDebug`, relaunch via agent-device, open a shell, observe. (Same loop used for
  the Mali blank-text fix — see `docs/projects/complete/native-terminal-mali-blank-text-debug.md`.)
- Visual: cursor toggles at the configured interval; stops (and stays visible) after
  the timeout; resumes + shows immediately on a keystroke.
- Escape behaviour: a program issuing `printf '\e[5 q'` (blinking block) blinks even
  when the app default is non-blinking; `\e[2 q` (steady block) stays solid.
- Keep it cheap: blink must not force extra redraws beyond the existing vsync loop, and
  must not churn the PTY/Term.

## Open decisions

- **Settings granularity:** expose just on/off, or the full Never/Off/On/Always + the
  two intervals? (Recommend Never/Off/On/Always + interval; hide timeout or default it.)
- **Clock source:** Rust `Instant` (self-contained, recommended) vs threading
  `frameTimeNanos` through the draw C-ABI.
- **Activity-reset fidelity:** how far to chase upstream's input+output reset vs a
  simpler interval-only blink.

## References

- This stack: `fressh-render/src/{content.rs,driver.rs,config.rs}`,
  `shim-uniffi/src/android.rs`, `android/.../HybridTerminal.kt`,
  `apps/mobile/src/app/(tabs)/settings/terminal.tsx`, `apps/mobile/src/lib/preferences.*`.
- Upstream: `alacritty/src/event.rs` (`update_cursor_blinking`/`schedule_blinking`/the
  `BlinkCursor` toggle), `alacritty/src/display/mod.rs` (`cursor_hidden`),
  `alacritty/src/config/cursor.rs` (enum + defaults 750 ms / 5 s),
  `alacritty_terminal/src/term/mod.rs` (`cursor_style().blinking`, escape handling),
  `extra/man/alacritty.5.scd` (~:548-584, the user-facing config docs).
