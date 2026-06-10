# GLES renderer: dual-source blending limitation

**Status:** known limitation, mitigated. Revisit if subpixel text AA becomes desirable.
**Scope:** the native terminal renderer (`@fressh/react-native-terminal`, `fressh-render` + the vendored alacritty fork) on **Android**.

## TL;DR

On Android the terminal renders through **native EGL → GLES2/3** (not ANGLE — ANGLE
is the *iOS* GLES→Metal path only). That GLES context does **not** support
**dual-source blending** (`GL_SRC1_COLOR` / `GL_ONE_MINUS_SRC1_COLOR`).

This blocks **no terminal feature**. The only consequence is that text uses
**grayscale antialiasing instead of subpixel AA** — a minor quality difference,
especially on high-DPI phones. Everything users actually interact with works:
cursor shapes, (future) cursor blink, colored text, fancy underlines, padding,
scrollback, etc.

## Background: where this surfaced

The Android **emulator** runs GLES via **gfxstream** (`libGLESv2_emulation.so`)
translating to the host GPU. gfxstream's GLESv2 validation rejects `GL_SRC1_COLOR`
as a blend factor:

```
E/GFXSTREAM GL2Encoder.cpp GL error 0x500 condition
  [!GLESv2Validation::allowedBlendFunc(sfactor) || !allowedBlendFunc(dfactor)]
```

`0x500` = `GL_INVALID_ENUM`. Real GLES devices without `EXT_blend_func_extended`
behave the same way.

### Where `GL_SRC1_COLOR` comes from

alacritty uses dual-source blending for **subpixel** text AA. Two call sites:

1. The **text** renderer's subpixel pass (`renderer/text/{glsl3,gles2}.rs`). On our
   context this path is **not taken** — the GLES2 text renderer auto-detects that
   dual-source blending is unavailable and falls back to grayscale AA (multi-pass).
   Verified: the `"Using dual source blending"` log line never appears, and text
   draws produce **no** blend errors.
2. **`Renderer::draw_rects`** (`renderer/mod.rs:260`) unconditionally *restores*
   blend state to dual-source after drawing rects — assuming the text renderer's
   "normal" blend is dual-source. On our grayscale path that assumption is wrong,
   so it both (a) restores the wrong blend and (b) raises `GL_INVALID_ENUM`.

We only call `draw_rects` for **non-block cursors** (beam / underline / hollow),
so block cursors never hit this. That's why earlier font-size-only work (block
cursor) never saw it.

## The bug it caused (fixed)

The per-frame `GL_INVALID_ENUM` from `draw_rects` lingers in the GL error queue.
A later **re-attach** runs `Renderer::new`, whose `gl_get_string` does a *strict*
`glGetError` check (`renderer/mod.rs:135`) and inherits the stale error → renderer
init fails → `fressh_terminal_attach` returns null → **black terminal**. Symptom:
an alternating fail/succeed pattern across re-attaches (each draw poisons the
queue; the next attach consumes the error and fails; the one after starts clean).

**Mitigation (current):** `fressh-render/src/driver.rs` drains the GL error queue
(`drain_gl_errors()`) immediately after `draw_rects`. Verified: 0 failed attaches
across repeated re-attach cycles with a beam/underline cursor. The cursor renders
correctly.

The drain neutralizes the *effect* but the invalid `glBlendFunc` call still fires
once per frame while a non-block cursor is visible (harmless — the next frame's
`draw_cells` resets blend — but it spams `GFXSTREAM` errors in logcat).

## What is NOT affected (i.e. not a real limitation)

- **Cursor shapes** — block (cell inversion), beam/underline/hollow (rects) all render.
- **Blinking cursor** — *not yet implemented*, but it is a time-based visibility
  toggle in the draw loop and has **nothing to do with blending**. Adding it is
  unaffected by this limitation.
- **Fancy underlines** (undercurl / dotted / dashed) — the rect fragment shader
  (`res/rect.f.glsl`) has a `GLES2_RENDERER` path and implements all kinds.
- **Colors / palette, padding, font size, scrollback** — all fine.

The single real effect: **grayscale text AA instead of subpixel**.

## Complete fix (future, if we want it)

Pick either:

1. **Fork patch (eliminates the invalid call + log spam):** in the alacritty fork
   (`rust/vendor/alacritty`, `renderer/mod.rs:260`), make `draw_rects`'s blend
   *restore* match the **active text renderer's** blend mode (grayscale → standard
   `glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)`) instead of always
   dual-source. Then `drain_gl_errors()` in `driver.rs` becomes unnecessary. This
   adds a second divergence to the fork beyond the existing renderer seam.
2. **Get subpixel AA back (only if a real device supports it):** if a target
   device advertises **and honors** `EXT_blend_func_extended`, the GLES2 text
   renderer will enable dual-source blending automatically and render subpixel AA.
   The emulator (gfxstream) does not honor it.

### iOS note

The planned iOS path is GLES→Metal via **ANGLE**, which supports dual-source
blending, so subpixel AA would work there. See `ReactNativeTerminal.podspec` and
`README.md` ("iOS GLES is deprecated-now → ANGLE→Metal later").

## References

- `packages/react-native-terminal/rust/fressh-render/src/driver.rs` — `drain_gl_errors()` + call site in `draw()`
- `rust/vendor/alacritty/alacritty/src/renderer/mod.rs:260` — the dual-source blend restore in `draw_rects`
- `rust/vendor/alacritty/alacritty/src/renderer/mod.rs:135` — the strict `glGetError` check in `Renderer::new`
- `rust/vendor/alacritty/alacritty/src/renderer/text/gles2.rs:43` — dual-source detection / grayscale fallback
