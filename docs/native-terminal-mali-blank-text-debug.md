# Native terminal: blank/black text on real Android (Mali) — debug log

**Status:** IN PROGRESS. One root cause fixed (EGL context stealing). A second,
independent bug (GLES2 grayscale multi-pass text renders nothing on Mali) is
diagnosed but the final clean fix is not yet confirmed on device.

**Symptom:** the native alacritty terminal (`@fressh/react-native-terminal`)
renders correctly on the **Android emulator** but shows a **black/blank render
plane on a real device** (Pixel 8 Pro, **Mali-G715**, OpenGL ES 3.2 `v1.r54p2`).
The chrome (header, key bar, keyboard) is fine; only the SurfaceView render plane
is blank. The shell connects and produces output (PROBE A/B confirm glyphs
rasterize + upload), and the surface IS composited (a forced magenta clear fills
it), but no cell backgrounds or glyphs appear.

Related but DISTINCT: [`gles-renderer-blend-limitation.md`](./gles-renderer-blend-limitation.md)
documents the dual-source-blending (`GL_SRC1_COLOR`) limitation + a fixed
re-attach black-terminal bug. That doc claims the renderer "falls back to
grayscale AA (multi-pass)" and "blocks no terminal feature." **This investigation
shows that grayscale multi-pass fallback ITSELF renders nothing on Mali** — i.e.
on real hardware it blocks ALL text. This doc extends that one.

---

## Environment / how to reproduce + iterate

- Device: physical Pixel 8 Pro (`husky`), Mali-G715, GLES 3.2. Emulator works, so
  you MUST test on the physical device.
- App is a dev build loading JS from Metro at `http://10.5.0.2:8082` (WSL host
  `eth0` IP, reachable from the device).
- **Rust build (native .so):** from the repo root (cwd matters — see gotchas):
  ```
  cd /home/ethan/fressh && nix develop -c bash -c \
    'cd packages/react-native-terminal/rust && cargo ndk -t arm64-v8a \
     -o ../android/src/main/jniLibs build -p shim-uniffi --release'
  ```
- **Install on device (over adb):**
  ```
  nix develop -c bash -c 'cd apps/mobile/android && ./gradlew installDebug'
  ```
- **Relaunch:** `agent-device open dev.fressh.app --platform android --relaunch`
- Logs: `agent-device logs clear --restart` then read
  `~/.agent-device/sessions/<session>/app.log`.

### Build/iterate gotchas (cost us real time)

1. **`nix develop` cwd drift.** The Bash shell cwd drifts into subdirs; always
   prefix `cd /home/ethan/fressh &&` before `nix develop`, or it errors with
   "not part of a flake".
2. **Metro watcher crash from Rust builds.** Metro watches the repo root, incl.
   `packages/react-native-terminal/rust/target`. `cargo`/`cargo-ndk` create+delete
   transient `*.temp-archive` files there; Metro's (watchman-less, WSL) fallback
   watcher crashes with `ENOENT` and the dev server silently dies, so the next app
   relaunch shows "Failed to connect to /10.5.0.2:8082". FIX applied:
   `apps/mobile/metro.config.js` now `resolver.blockList`s `/rust/target/`. If
   Metro dies anyway, restart it: `cd apps/mobile && nix develop ../.. -c bash -c
   'bunx expo start --dev-client --port 8082'` (background) and wait for
   `packager-status:running` on `localhost:8082`.
3. **Probe log gating.** Debug probes counted with a per-process `AtomicU32` only
   log the first N draws. The native process restarts only on a full app relaunch
   (NOT a Metro JS reload), so to capture fresh probe output: relaunch, THEN
   `logs clear --restart`, THEN open a shell (the terminal only draws once a shell
   is open, so the first draws after that are captured).

---

## ROOT CAUSE #1 (FIXED): EGL context stolen by react-native-skia

The terminal's EGL context was made current **once** at attach (`egl.rs`
`EglContext::create`) and never re-asserted. `ThemedBackground.tsx` mounts a
full-screen react-native-skia `<Canvas>` (via `ThemedScreen`) behind every screen,
which drives **its own EGL context on the same (UI) thread every frame**. EGL's
current context is per-thread global state, so from frame 2 onward the terminal's
`draw_term`/`swap_buffers` ran against **Skia's** context.

Evidence (device probes):
- `glIsProgram(textProgramId)` = 0, `glUseProgram` → `GL error 0x502`
  (`GL_INVALID_OPERATION`), `CURRENT_PROGRAM` = a foreign program id, on every
  frame after the first.
- Frame 1 worked (context still current from attach); frames 2+ all errored.

**FIX (kept):** `fressh-render/src/egl.rs` — add `EglContext::make_current()` and
call it at the start of `draw_term`, `clear`, `resize`, and `set_config`. After
this, `isProgram=1`, `CURRENT_PROGRAM` correct, `glGetError`=0 on all draws.

This is necessary but NOT sufficient — text was still blank after it (see #2).

NOTE: disabling Skia is NOT needed and does NOT fix the blank text. We confirmed
(a) with Skia active, a forced magenta clear fills the surface (no z-order/overlay
conflict), and (b) disabling `ThemedBackground` left text still blank. So Skia's
only involvement was the context-stealing, which `make_current` fully resolves.

---

## FINDING #2 (diagnosed, fix not yet confirmed): grayscale multi-pass text draws nothing on Mali

After #1, every draw succeeds (no GL error) yet no cells/glyphs appear. We ruled
out, with on-device tests, essentially everything EXCEPT the text blend:

| Hypothesis | Test | Result |
|---|---|---|
| Surface not composited / z-order | force magenta `clear` | surface = solid magenta → **composites fine** |
| Geometry degenerate | shader outputs solid green (all passes) | green squares, scrollable → **cell geometry fine** |
| Glyph quads degenerate | text pass solid magenta | magenta blocks, glyph-sized/varying-height → **glyphCoords fine** |
| Vertex attribs wrong | PROBE E `glGetVertexAttribiv` | `enabled=[1,1,1,1,1] size=[2,2,2,4,4] type=[SHORT,SHORT,FLOAT,UBYTE,UBYTE]` → **all correct** |
| Viewport/projection off-screen | PROBE F `GL_VIEWPORT`/projection | `viewport=[0,0,1284,1959]`, scissor off, projection scale = 2/w,-2/h → **correct** |
| UVs wrong | PROBE G logs computed UVs | `'a' off=(0,0) → uv=(0,0,0.033,0.040)`, atlas 1024² → **UVs correct** |
| Atlas empty | dump atlas via `texture2D(mask, gl_FragCoord/1280)` | scattered glyph text visible at screen bottom → **atlas HAS data** |
| Texture sampling broken | text pass `texture2D(mask, TexCoords).rgb * 4` opaque | **readable glyph shapes appear** → sampling + UVs work |
| 3-pass subpixel blend | pristine renderer + `make_current` | **BLANK** |
| Single-pass premult (`fg*cov`, `ONE/ONE_MINUS_SRC_ALPHA`) | build #20 | **BLANK** (unexpected — see open questions) |
| `fg` color zero? | output solid `vec4(fg,1.0)` | **BLANK (build #21)** → fg is dark/zero |
| `fg` mis-scaled (normalized/precision)? | output `vec4(fg*255.0,1.0)` | **BLANK (build #22)** → fg is genuinely 0, not a small scaled value |

### Key facts established
- The atlas texture contains real glyph data; UVs point at it correctly;
  `texture2D(mask, TexCoords)` returns the glyph coverage. Proven because a single
  **opaque** pass that outputs `texture2D(mask, TexCoords).rgb * 4.0` renders
  **readable glyph shapes** (build #18). (The `* 4` brightened it; the raw sample
  looked near-black, i.e. sampled coverage values are low/dim — see open questions.)
- The upstream non-dual-source text path (`gles2.rs render_batch`, the `else`
  branch) renders subpixel AA in **3 passes** using destination read-back
  (`GL_ONE_MINUS_SRC_COLOR`, `GL_ONE_MINUS_DST_ALPHA`). On Mali these draws return
  no GL error but write no pixels → blank. This IS the "grayscale AA (multi-pass)"
  fallback referenced in `gles-renderer-blend-limitation.md`.

### What worked vs didn't (renderer experiments)
- WORKS (debug only): single **opaque** pass, output `coverage * 4` — but ignores
  `fg` color (all white) and `* 4` is a hack.
- BLANK: the real 3-pass subpixel blend.
- BLANK: single pass with `glBlendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` and
  premultiplied shader output → double-multiplies coverage (`fg*cov*cov`) → too
  dim. (This was a wrong blend, not a real candidate.)
- BLANK: single pass with `glBlendFunc(ONE, ONE_MINUS_SRC_ALPHA)` (correct
  premultiplied over-blend) + real `render_text` pass-3 output `(fg*cov, cov)`.
  **This SHOULD have worked** (`fg*cov + dst*(1-cov)`) — that it didn't is the
  current open question (build #20).

## ROOT CAUSE #3 (FIX IMPLEMENTED, awaiting device confirm): non-normalized UNSIGNED_BYTE color attributes read as zero on Mali

Builds #21/#22 nailed it: the glyph **foreground color `fg` is zero** on device.
`vec4(fg,1.0)` was blank AND `vec4(fg*255.0,1.0)` was ALSO blank — so `fg` is
**genuinely 0**, not a small mis-scaled value.

The two color attributes (`textColor`, `backgroundColor`) are uploaded as
`GL_UNSIGNED_BYTE` with `normalized = GL_FALSE`, and the vertex shader divides by
255. **Non-normalized integer vertex attributes feeding a `float`/`vec` shader
attribute read back as zero on the Mali-G715 driver** (the `SHORT` position and
`FLOAT` uv attributes are fine; only the byte attributes fail). The emulator's
gfxstream/desktop-GL path handles non-normalized bytes, so it only repro'd on
device. This is why every "real color" render was blank while the `coverage*4`
debug (which ignores `fg`) rendered.

**FIX (implemented, build #23):**
- `gles2.rs`: the two color `add_attr!` calls now pass `normalized = GL_TRUE`
  (the `add_attr!` macro gained a normalized parameter).
- `text.v.glsl`: drop the `/255.0` for `fg`/`bg` (normalized already gives 0..1),
  and scale the packed flags byte back up (`colored = floor(textColor.a*255 + 0.5)`).

Combined with #1 (`make_current`) and #2 (single-pass premultiplied text), build
#23 is the candidate complete fix. **Awaiting on-device confirmation of colored
text.**

## Web-search research assessment (which leads helped)

A research pass was run. Net: it correctly framed the *class* of bug but its two
specific mechanisms were already disproven by our device tests.

HELPFUL / confirmed:
- "Keep a single grayscale premultiplied-alpha pass" for Mali/TBDR — matches our
  finding-#2 fix; ghostty/wezterm use exactly this architecture.
- Mali lacks `EXT_blend_func_extended` (so the 3-pass fallback is taken) — matches
  our logs (`"Using dual source blending"` never prints).
- `GL_UNSIGNED_BYTE` vertex attributes are a known Mali footgun — matches root
  cause #3 (general direction correct).
- Tooling suggestions worth keeping for future GPU bugs: **Android GPU Inspector /
  RenderDoc** frame capture (shows exact per-vertex attribute values reaching the
  shader — would have found #3 in one capture), and the **Mali Offline Compiler**.

NOT helpful / DISPROVEN by our tests (do not pursue):
- "Precision-qualifier clamping (lowp clamps 255→~2 → fg≈0.008)": disproven by
  build #22 — if `fg≈0.008`, `fg*255≈2` → clamps to 1.0 → bright text; we got
  BLANK, so `fg` is exactly 0, not clamped-small. Also `fg` is reduced to 0..1 in
  the vertex stage and the fragment `varying mediump vec3 fg` easily holds 0..1.
- "Non-normalized byte silently treated as normalized (255→1.0 → /255 → 0.004)":
  disproven by the same build #22 (would also show bright at `*255`). The driver
  does not mis-scale; it returns **0**.
- Dual-source-blending / `EXT_shader_framebuffer_fetch` / multipass dst-readback
  theories: irrelevant to the *primary* cause. We're already on the fallback path,
  and a single-pass premultiplied draw works, so the blend is not why text is
  blank.

Cloning reference repos (ARM SDK, ghostty, wezterm, Khronos specs) is now LOW
priority: the fix was determined empirically. ghostty/wezterm only *confirm* the
single-pass grayscale architecture we already adopted; the dual-source/framebuffer-
fetch material is moot. Revisit only if build #23 does NOT render colored text.

### Remaining minor open question
- **Why is sampled coverage dim** (the raw sample needed `*4` to be clearly
  visible)? Likely just normal AA edge falloff at this font size; the real
  `fg*coverage` over-blend should look correct. Confirm visually on #23; only
  investigate if text looks too faint.

---

## Current working-tree changes (as of this writing)

KEEP (real fixes):
- `packages/react-native-terminal/rust/fressh-render/src/egl.rs` — `make_current`
  per frame (root cause #1). **This is our crate, not vendored.**
- `apps/mobile/metro.config.js` — blockList `/rust/target/` (build-infra fix).

IN FLUX (vendored alacritty fork, `gles2.rs` / `text.f.glsl`):
- Currently holding a `[FRESSH TEST]` shader hack for the `fg` probe (build #21).
  All probes A–G and earlier shader hacks have been reverted; the submodules were
  `git checkout`-ed to pristine once, then only the finding-#2 fix experiments
  remain. **Before committing: `git -C <submodule> status` and ensure ONLY the
  intended single-pass text fix remains — no `[FRESSH TEST]`/`PROBE` lines.**

Already reverted to pristine: `driver.rs` (magenta), `ThemedBackground.tsx`,
the ES2/ES3 context experiment (back to `CONTEXT_CLIENT_VERSION, 2`), all probes.

DEAD ENDS (do not retry):
- Switching to a GLES3 context to "get VAOs" — VAOs were already valid
  (`isVertexArray=1`); ES3 + the unsized `GL_RGBA` atlas format made things worse.
- Disabling react-native-skia — `make_current` already resolves the only conflict.
- Chasing texture upload / atlas allocation — the atlas has data.
