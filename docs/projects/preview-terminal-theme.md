# Future project: live terminal preview in Terminal settings

**Status:** NOT STARTED — exploratory/scoped. Small, self-contained, high-polish.

**Scope (if pursued):** the mobile app's Terminal settings screen
(`apps/mobile/src/app/(tabs)/settings/terminal.tsx`) + a thin preview affordance.
Possibly a small `fressh-core`/`fressh-render` addition depending on the content
strategy chosen below.

## Goal

On the Terminal settings screen, render a **small live preview of the terminal** so the
user sees what their color-scheme / font-size / padding / cursor-style / bold-is-bright
choices actually look like — *as they change them*, before connecting to anything. Right
now you pick "Dracula, 16pt, beam cursor" blind and only find out on your next SSH
session.

## Why this is mostly free

The config pipeline is already end-to-end and **live-reflowing**, and the settings
screen already holds the exact config object a preview needs.

- `useTerminalRenderConfig()` (in `apps/mobile/src/lib/preferences.tsx`) already
  aggregates the render-time prefs into one memoized object: `fontSize`, `padding`,
  `cursorStyle`, `colorScheme`, `boldIsBright`. The settings screen reads it today.
- `<Terminal config={...} />` (`packages/react-native-terminal/src/Terminal.tsx`) takes
  that object, scales pt→px by `PixelRatio.get()`, serializes to `configJson`, and the
  native side hot-applies it: `HybridTerminal.kt` → `nativeSetConfig` →
  `TerminalRenderer::apply_config()` (`fressh-render/src/driver.rs`), which rebuilds the
  glyph cache and swaps the palette **without a restart**.
- The 5 schemes (`default`, `solarizedDark`, `solarizedLight`, `dracula`, `gruvboxDark`)
  resolve to full 16-color palettes in `fressh-render/src/config.rs`
  (`ColorScheme::by_name`).

So a preview is "mount a small `<Terminal>` with the live `config` and *some* content."
The only real design question is **what content to show**, because the renderer draws a
`Term` looked up by `shellId` from the registry (`registry.rs` `shell_term`), and today
the only way a `Term` gets populated is a live SSH shell feeding it bytes. With no
`shellId`, the view calls `present_clear()` and paints only the background — which proves
fg/bg but shows no text, no ANSI colors, no cursor-on-glyph. We want a richer sample.

## Content strategy — the one real decision

We need a `Term` populated with a representative sample (a fake prompt, a few ANSI
colors across the palette, a cursor sitting on a glyph) that is **not** backed by SSH.
Options, cheapest → most invasive:

- **A. Throwaway demo shell fed canned bytes (least new native code).** Add a
  control-plane entry point that creates a registry `Term` *not* bound to an SSH channel
  and feeds it a fixed byte string — a scripted snippet exercising the palette, e.g.:

  ```
  $ ssh user@host
  \x1b[32m✓ connected\x1b[0m   \x1b[33mwarn\x1b[0m  \x1b[31merr\x1b[0m  \x1b[34m~/code\x1b[0m
  $ git status   # cursor parks here
  ```

  The `Processor`/vte path already turns bytes into grid state; we'd just need a "feed
  these bytes to this Term" call that doesn't require a `Shell`/SSH channel. Bind it by a
  reserved `shellId` (e.g. `"__preview__"`), unbind/destroy on unmount. **This is the
  recommended path** — it reuses the entire existing parse+render pipeline and the only
  new surface is "create a Term + write bytes locally."

  > This primitive — *a `Term` driven by a local byte source instead of SSH* — is the
  > **same** primitive [on-device-shell.md](on-device-shell.md) needs. If that project
  > lands, the preview is trivially a special case of it (feed a string instead of a
  > PTY). Worth building the local-feed seam with both in mind.

- **B. Native "render a static demo grid" path.** Extend `fressh-render` to draw a
  hardcoded sample grid with no `Term` at all. Keeps it fully synthetic but duplicates
  content the parser would otherwise produce, and bypasses the real rendering path
  (so it's a *less* faithful preview). Reject unless A proves awkward.

- **C. Static mockup (non-native).** Render the sample with React/Skia using the same
  palette RGB values, no `<Terminal>` at all. Cheapest, but it's a *re-implementation* of
  the renderer's look — font metrics, glyph rasterization, padding, cursor shape would
  all subtly differ from the real thing, defeating the "see what it'll really look like"
  purpose. Reject for a feature whose whole point is fidelity.

## Sketch (option A)

1. Settings screen mounts a fixed-height `<Terminal>` (e.g. ~8 rows) with
   `config={useTerminalRenderConfig()}` and `shellId="__preview__"`.
2. On mount, call a new `core.createPreviewTerm(id, demoBytes)`; on unmount, destroy it.
3. Changing any setting already flows through `config` → `nativeSetConfig` → live
   reflow. **The preview updates as the slider moves** — no extra wiring.
4. Demo bytes are a single shared constant exercising: a prompt, the 8 normal + 8 bright
   ANSI colors, default fg/bg, and a cursor resting on a character.

## Open questions

- **Sizing.** Fixed row/col count, or fit to a card width? Font-size changes alter how
  many cols fit — do we letterbox, scroll, or just clip? A small fixed grid (e.g.
  40×8) that clips is probably fine for a preview.
- **Where on the screen.** Sticky preview pinned at top while the settings list scrolls
  beneath it (so it's always visible as you adjust), or inline near the color picker?
  Sticky-top reads better for "watch it change."
- **Demo content.** One generic snippet, or rotate a couple (a build log, a git status,
  an `ls --color`)? Start with one good palette-exercising sample.
- **Lifecycle cost.** Spinning a native Term per settings-screen visit — confirm
  create/destroy is cheap and leak-free; reuse a singleton preview Term if not.
- **App-theme vs terminal-theme.** The terminal color schemes are separate from the
  app's uniwind UI themes (phosphor/graphite/aurora/monolith). The preview shows the
  *terminal* palette only — make sure the card framing doesn't imply the UI theme
  changes too.

## Why it's worth doing

Pure UX polish on an already-complete config pipeline. Terminal appearance is the kind of
setting people fiddle with, and "preview before apply" turns a guess-and-check loop
(change → open a session → squint → go back) into instant feedback. Low risk, no
backend, no protocol — the hardest part is just deciding the demo content and the
local-feed seam, the latter of which doubles as groundwork for the on-device shell.
