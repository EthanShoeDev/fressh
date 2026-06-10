# Terminal renderer ↔ view size mismatch (selection drift + cut-off scrollback)

**Status: RESOLVED (2026-06-03), device-verified on the Android emulator (BOTH keyboard
directions).** Real root cause turned out to be deeper than the layout: `egl.resize()` read
the surface size from **`eglQuerySurface(EGL_WIDTH/HEIGHT)`**, which **lags the SurfaceView's
new buffer geometry by ~one frame** (it reflects the buffer from the last `eglSwapBuffers`).
So whenever it was read one-shot in `surfaceChanged`, it returned the *previous* size and the
grid was set one transition behind — wrong after every keyboard toggle. Fix = a JS layout
change that reliably resizes the view + polling the surface size from the **draw loop**
(post-swap, so the value has settled) and reflowing only when it actually changes. Fix code
is **uncommitted** (working tree). See **"The fix (RESOLVED)"**; original investigation kept
for history.

## The fix (RESOLVED)

Three parts (JS + Kotlin + Rust; the Rust part needs a `.so` rebuild — `native:build:android`
— but no ubrn regen since the C-ABI signatures are unchanged):

1. **JS — `detail.tsx`:** dropped KC's `KeyboardAvoidingView`. The terminal stays `flex:1`
   inside a fixed-height column (the window does NOT shrink for the IME here); a settled
   `KeyboardEvents` `keyboardDidShow/Hide` listener tracks the keyboard height and drives the
   toolbar's `marginBottom`. Growing that margin makes flexbox shrink the `flex:1` terminal →
   a real layout change in BOTH directions → `onLayout` (sizeRef) and the native
   `onSizeChanged` both refire. `marginBottom` clears the keyboard's overlap with *this
   column*, not the whole screen: the column sits above the native bottom tab bar
   (expo-router `NativeTabs`), so we `measureInWindow` the column's on-screen bottom and
   subtract the reserved space below it from the screen-relative keyboard height
   (`marginBottom = max(keyboardHeight − bottomReserved, insets.bottom)`). Without that the
   toolbar floated a tab-bar-height above the keyboard.
2. **Native — `HybridTerminal.kt`:** plain default `SurfaceView` (buffer auto-tracks the view).
   *(An earlier `onSizeChanged → setFixedSize(w,h)` made SHRINK work but broke GROW — a fixed
   buffer just gets scaled, so growing the view never requested a bigger buffer. Reverted.)*
3. **Rust — `egl.rs` + `shim-uniffi/android.rs`:** added `EglContext::surface_size()` and a
   `sync_surface_size(attached)` that re-queries the surface size and reflows the renderer +
   bound shell **only when it changed since the last sync**. It's called every frame from the
   **draw loop** (`fressh_terminal_draw`) — which runs after `eglSwapBuffers`, so the queried
   size has settled — and from `surfaceChanged` (`fressh_terminal_resize`, now a thin caller;
   it no-ops on the lagged read and the draw loop catches the settled size 1–2 frames later).
   The grid/`SizeInfo`/PTY now converge to the real surface size in both directions.

**Device verification (emulator, `ethan@nas.lan` shell):**
- Keyboard UP→DOWN→UP round-trip: `sync_surface_size` reflows the grid in BOTH directions —
  `surface=(1028x1564) grid=31x24` (kb down) ↔ `surface=(1028x744) grid=31x11` (kb up). The
  queried surface size now MATCHES the view's `onSizeChanged` size (no lag).
- Keyboard down: terminal grows and **fills with content** (scrollback pulled in to fill the
  new rows) — no "cut off halfway / blank below". Keyboard up: content bottom-anchored, prompt
  at the bottom edge — no cut-off.
- `frac_to_point` uses the current resized grid (`lines=24`, `disp=0`); long-press "stored"
  mapped to its exact cell (`col3 vp_line15`) and the highlight + Copy landed on that word —
  no multi-row drift.
- **Both** toolbar rows (incl. CTRL/ALT) visible above the keyboard.

**Cleanup done (2026-06-03):**
- Toolbar↔keyboard gap closed via the `measureInWindow`-based `marginBottom` above
  (device-verified: toolbar now sits just above the keyboard, both rows visible).
- All temp diagnostics removed: control.rs `log::info!` (frac/selection), the
  `sync_surface_size` + Kotlin `onSizeChanged` logs, and the `log` dep in
  `fressh-core/Cargo.toml`. `.so` rebuilt + app reinstalled; both keyboard directions
  re-verified visually (content fills in both states, no cut-off, gap closed).

**Remaining note (non-blocking):**
- An agent-device *stationary* long-press sometimes yields an empty Semantic selection on the
  lower rows (no word-snap) — a test-harness artifact observed during verification, not a
  product misalignment (the "stored" case word-snapped + highlighted correctly).

All fix code is **uncommitted** (working tree): `apps/mobile/src/app/(tabs)/shell/detail.tsx`,
`packages/react-native-terminal/android/.../HybridTerminal.kt`,
`packages/react-native-terminal/rust/fressh-render/src/egl.rs`,
`packages/react-native-terminal/rust/shim-uniffi/src/android.rs`
(+ `fressh-core/Cargo.toml`, `fressh-core/src/control.rs` diagnostic removals).

---

## (historical) original investigation

This doc captured the symptoms, what we proved, the dead ends, the code state, and the
next steps so we could pick it up cold. Superseded by the fix above.

---

## Feature context (what was built this session)

Touch interaction for the native `<Terminal>` (`@fressh/react-native-terminal`):

- **Gestures live in JS** (`react-native-gesture-handler`) in
  `apps/mobile/src/app/(tabs)/shell/detail.tsx` → component `TerminalSurface`.
- **Logic lives in shared Rust**, keyed by `shellId` like `send_data`
  (`rust/fressh-core/src/control.rs`): `scroll`, `selection_start/update/clear/text`.
  uniffi exports in `rust/shim-uniffi/src/lib.rs`; JS wrappers in
  `packages/react-native-terminal/src/ssh.ts` (+ re-exports in `index.ts`).
- Selection highlight: `content.rs` reads the `SelectionRange` that
  `Term::renderable_content()` already computes → reverse-video.
- Copy: `expo-clipboard`. Paste: already handled by the hidden `TextInput`.
- `GestureHandlerRootView` added to `apps/mobile/src/app/_layout.tsx`.

Working/verified earlier: drag-scroll (scrollback + mouse/alt-screen aware), long-press
word-select, drag-to-extend, Copy button, both key-toolbar rows above the keyboard.

Related memory: `terminal-touch-keyboard-coords` (note: parts of it are now superseded —
see "Keyboard layout" below).

---

## The two symptoms (user-reported)

1. **Selection is mismatched to the touch location when the keyboard is up.** Long-press a
   word and a *different* word (a few rows higher) gets selected/copied. With the keyboard
   **down** it's pixel-perfect.
2. **Scrollback looks "cut off on the top, but there's still plenty of (empty) space on the
   renderer."** Strongly implies the **Term grid, the renderer's `SizeInfo`, and the
   on-screen SurfaceView bounds are not all the same size** — i.e. they've desynced.

Both point at the same root: **on-screen pixels no longer correspond 1:1 to the rendered
grid when the keyboard is open.**

---

## What we proved (hard data, from logcat)

Diagnostics were temporarily added (and are currently still in the tree — see Code state):
`fressh_terminal_resize` logs `grid`, `cell`, `pad`, computed `surface~=(WxH)`;
`frac_to_point`/`selection_start` log the mapping + selected text.

- The **mapping math is correct.** With the keyboard **down**, long-press selects exactly
  the word under the finger (verified "Data", "files", "stored" — wrap-aware semantic).
- Metrics seen: `cell=(32,62) pad=(15,15)`, grid `31x25`/`31x29` full-screen.
- **Keyboard `'pan'` mode (original) was the first culprit:** with
  `softwareKeyboardLayoutMode: 'pan'` (manifest `adjustPan`) the OS slides the full-height
  surface up *behind* the keyboard; RNGH touch coords don't know about that pan → every
  touch offset by the pan amount. Switched to `'resize'` (needs `expo prebuild`; `expo
  run:android` does NOT re-sync the manifest — verify with
  `grep windowSoftInputMode apps/mobile/android/app/src/main/AndroidManifest.xml`).
- **`'resize'` (adjustResize) does NOT actually shrink the window for the IME on this
  RN 0.85 / Android 15 edge-to-edge build** by itself — keyboard just overlays the bottom.
- **The SurfaceView resize fires INCONSISTENTLY when the keyboard opens.** `fressh_terminal_resize`
  was observed emitting `31x14`, `31x20`, and also **not firing at all** on keyboard open
  (grid stayed `31x25`/`31x29`). When it doesn't fire, the renderer `SizeInfo` + Term grid
  stay full-height while the on-screen view is short → **mismatch** (this is symptom #1 and
  almost certainly #2). This inconsistency is the crux and is **not yet root-caused**.

---

## Keyboard layout: what we tried (and the trade-offs)

The flex column is `[terminal (flex:1), KeyboardToolbar (2 rows, ~100dp)]` inside a
keyboard-avoiding container; `softwareKeyboardLayoutMode: 'resize'` throughout.

- **RN's `KeyboardAvoidingView`** (`behavior='height'`, `keyboardVerticalOffset={120}`):
  shows BOTH toolbar rows correctly, BUT the **SurfaceView did not resize** (no
  `fressh_terminal_resize` on keyboard open) → selection mismatched. (So the earlier memory
  claim "RN's KAV works fine" is **wrong** for the surface-resize requirement.)
- **`react-native-keyboard-controller`'s `KeyboardAvoidingView`** (`behavior='height'`,
  no offset): selection was *closer to* correct (it sometimes resized the surface), BUT it
  **clips the toolbar's 2nd row (CTRL/ALT)** behind the keyboard.
- Adding `keyboardVerticalOffset` to KC's KAV **broke alignment again** (desyncs surface vs
  touch view). Lifting only the toolbar via `marginBottom: insets.bottom` kept the toolbar
  visible but selection was **still** mismatched (surface still not tracking the view).

Net: no keyboard-avoiding combination reliably gives BOTH (a) surface resizes to match the
visible view AND (b) both toolbar rows visible. The SurfaceView-resize inconsistency
defeats every variant.

---

## The robustness fix already applied (resolution-independent mapping)

Because pixel metrics kept drifting from the on-screen size, the touch mapping was changed
to be **grid-fraction based** so it can't depend on the surface buffer / cell metrics being
in sync:

- JS measures the gesture view via `onLayout` (`sizeRef`) and sends touches as
  **fractions of the view** (`fx = e.x/width`, `fy = e.y/height`; scroll: `e.changeY/height`).
- Rust `frac_to_point` maps `fx*columns`, `fy*screen_lines` onto the grid (+ `display_offset`),
  no pixel metrics. `scroll` converts `dy_frac*screen_lines` → rows (remainder carried).
- uniffi signatures are unchanged (params still typed `f32`, now carry fractions), so this
  needs only a `.so` rebuild, **no ubrn binding regen**.

**Why this still might not fully fix it:** fraction-of-view → fraction-of-grid is only exact
if the displayed surface is a linear scale of the grid (i.e. the whole grid maps onto the
whole view). If the SurfaceView **clips** (shows only part of the buffer, bottom-aligned)
rather than **scales**, fractions still drift. We did NOT get to confirm scaled-vs-clipped
because of the blocker below. **This is the #1 thing to verify next.**

---

## Blocker that stopped verification (don't lose time on this again)

1. **A deadlock I introduced (FIXED):** a diagnostic in `fressh_terminal_draw`
   (`android.rs`) called `fressh_core::shell_grid_size(id)` *while the Term mutex was already
   locked by the draw* → `std::Mutex` is not reentrant → main/render thread hangs → Android
   ANR → `signal 3` (SIGQUIT dump) → `signal 9` (SIGKILL). Looked like random "crashes."
   Fixed by removing that call (and the helper). **Lesson: never re-lock the Term from
   inside the draw; read from the already-held guard.**

2. **Emulator/dev-client got wedged** from heavy thrashing (many force-stops, `monkey`,
   `am start`, rapid blind taps, Metro restarts). End state: app dies with
   `ActivityManager: Process … failed to complete startup` **before any JS runs**
   (`ReactNativeJS` count 0), i.e. Android's process-start watchdog kills it during
   first-run class verification / bundle fetch. Confirmed NOT the cold bundle (warmed Metro:
   bundle compiles 200 / 12.9 MB / ~7.5 s and is cached) and NOT host load (~0.3). This is
   environmental. **Next time: cold-boot the emulator (user manages it) before verifying,
   and avoid force-stop/monkey/rapid relaunch loops.**

Useful: warm Metro deterministically before launching —
```
url=$(curl -s -H "expo-platform: android" -H "expo-dev-client: true" http://localhost:8082 \
  | grep -oE '"url":"http[^"]*\.bundle[^"]*"' | head -1 | sed 's/"url":"//;s/"$//;s|\\u0026|\&|g;s|\\/|/|g')
curl -s -m 180 -o /dev/null -w "%{http_code} %{time_total}s %{size_download}\n" "$url"
```

---

## Leading hypothesis (to confirm next)

The SurfaceView's surface **buffer** is not being resized in lockstep with its **view
bounds** when the keyboard opens (surfaceChanged fires unreliably). So:
- renderer `SizeInfo` + Term grid = full height (e.g. 29 rows),
- on-screen view = short,
- Android either scales or (more likely, given "cut off on top, space at bottom") clips the
  buffer → visible content ≠ grid fractions → selection drift + cut-off scrollback.

This is consistent with both symptoms and with the inconsistent resize logs.

---

## Next steps (resumable plan)

1. **Cold-boot the emulator** (clean state) and `bun run android` once; warm Metro; verify
   the app starts and reaches JS.
2. **Confirm scaled vs clipped:** with keyboard up, set the terminal to a known full-screen
   pattern (e.g. `seq 1 200`), screenshot, and long-press top/middle/bottom of the *visible*
   area; read `frac_to_point` + `selection_start` logs. If fractions already map correctly →
   the resolution-independent fix is sufficient; just settle the keyboard layout. If they
   drift → the surface is clipped, go to step 3.
3. **Make the SurfaceView buffer track the view deterministically.** Options to evaluate:
   - Force the surface size in the Android view: `surfaceView.holder.setFixedSize(w, h)` on
     layout change, and/or ensure `surfaceChanged` → `fressh_terminal_resize` fires on every
     keyboard-driven bounds change (the inconsistency is the bug to kill).
   - Consider driving terminal height from KC's keyboard-height animation value
     (`useReanimatedKeyboardAnimation` / `KeyboardController` height) and setting an explicit
     height on the terminal container, so the layout (and thus the SurfaceView) resizes
     deterministically when the IME opens — instead of relying on a KeyboardAvoidingView.
   - Re-evaluate `KeyboardStickyView` for the toolbar + an explicit-height terminal.
4. Once the surface reliably matches the view, re-check both keyboard layouts for the
   2-row toolbar visibility (CTRL/ALT) and pick the combination that satisfies both.
5. **Remove the temporary diagnostics**: `log::info!` in `frac_to_point` + `selection_start`
   (`control.rs`), the extended `fressh_terminal_resize` log (`android.rs`), and the `log`
   dep re-added to `fressh-core/Cargo.toml`. Restore `fressh-core` to minimal deps.

---

## Files touched this session (all uncommitted)

- `apps/mobile/app.config.ts` — `softwareKeyboardLayoutMode: 'pan' → 'resize'` (requires
  `expo prebuild` to hit the manifest).
- `apps/mobile/src/app/_layout.tsx` — `GestureHandlerRootView` wrapper.
- `apps/mobile/src/app/(tabs)/shell/detail.tsx` — `TerminalSurface` (RNGH gestures, Copy
  button), KeyboardAvoidingView variant currently = **KC's** with `marginBottom: insets.bottom`
  on the toolbar; fraction-based touch coords via `onLayout`/`sizeRef`. (Keyboard-layout
  choice is the open question — see above.)
- `packages/react-native-terminal/src/ssh.ts`, `src/index.ts` — scroll/selection wrappers.
- Rust: `fressh-core/src/control.rs` (scroll/selection, `frac_to_point`, temp logs,
  `set_render_metrics` retained but unused by mapping), `session.rs` (`RenderMetrics`,
  `metrics`, `scroll_remainder` fields), `lib.rs` (re-exports); `fressh-render`
  (`cell_metrics()` on driver+egl; selection highlight in `content.rs`);
  `shim-uniffi/src/lib.rs` (uniffi exports), `android.rs` (publish metrics on resize/config,
  extended resize log). `fressh-core/Cargo.toml` has a temp `log = "0.4"`.
- Rebuild: `cd packages/react-native-terminal && bun run native:build:android` (builds the
  `.so`); ubrn regen only needed if uniffi signatures change (they didn't).
