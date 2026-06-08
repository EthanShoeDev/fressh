# Project: smart-terminal surface — the production UI the smart features render into

**Status:** IN PROGRESS (2026-06-08) — **v0 (context bar) LANDED**; rest designed, not yet
built. This is the presentation + consumer-API layer that turns the semantic-events
pipeline into product. It defines *where* each "smart terminal" feature lives on the
terminal screen and *what shared store* they all read, so git / AI / preset-commands don't
each reinvent placement and plumbing.

**v0 shipped (JS-only, no native change):**
- `src/lib/terminal-semantics.ts` promoted to the canonical per-shell **`ShellContext`**
  store + `useShellContext(shellId)` hook (adds `sawOsc`; dropped the debug-only event-log
  machinery).
- `src/components/terminal/ContextBar.tsx` — the always-visible row under the app bar:
  `active` (cwd · running-spinner+command | exit-pill + duration) / `waiting` / hidden when
  the global kill-switch is off. Mounted as a real row in `terminal.tsx`.
- `TerminalSemanticsDebugPanel` **deleted** (its role is absorbed).

**Prerequisite / producer:** [terminal-semantic-events.md](complete/terminal-semantic-events.md)
— the OSC 7/133/633 pipeline that lifts cwd, command lifecycle, exit code, and command
text out of the native byte stream into JS. That doc owns the *data*; this doc owns the
*presentation + the consumer store*.

**Consumers (these render into the surfaces defined here):**
[git-diff-integration.md](future/git-diff-integration.md),
[ai-integration.md](future/ai-integration.md),
[preset-command-buttons.md](future/preset-command-buttons.md).

**Scope:** `apps/mobile` only — the terminal screen
(`src/app/(tabs)/servers/terminal.tsx`), a promoted per-shell context store
(`src/lib/terminal-semantics.ts` → the canonical `ShellContext`), and new presentation
components. No `@fressh/react-native-terminal` (native) changes — every surface is a
React overlay/row over the existing native `<Terminal>` view, the pattern already used
for the copy button and the keyboard toolbar.

## The organizing idea: two zones

The smart features split cleanly by *interaction style*, and the layout follows:

- **Ambient zone (glanceable, always visible)** — facts you want to *see* without acting:
  cwd, last exit code, running spinner, command duration, and the git badge (branch,
  ahead/behind, dirty count). → A thin **context bar**.
- **Action zone (summoned, zero permanent space)** — things you *do*: run a preset, ask
  the AI, open the changed-files list, peek a diff. → **Paged keyboard toolbar** +
  **bottom sheets** for the deep views.

Decided layout (2026-06-08, with Ethan):

```
┌──────────────────────────────┐
│ ● ethan@nas       [ × Close ] │  app bar (native Stack header, unchanged)
├──────────────────────────────┤
│ ~/proj  ⎇main +3  ✓  ·1.2s    │  CONTEXT BAR  → tap = details sheet
├──────────────────────────────┤
│   terminal output …          │  native <Terminal> (+ copy/select overlays)
├──────────────────────────────┤
│  esc / | home ↑ end pgup     │  PAGED TOOLBAR — page 1: keys (default)
│  tab ctrl alt ← ↓ → pgdn     │
│         ●  ○  ○   swipe ›     │  page dots: keys · presets · smart
└──────────────────────────────┘
   page 2: [git status][ls -la][clear][+]      ← preset commands
   page 3: [✦ Ask AI][⎇ Changed files][⋯]      ← smart actions
```

## Surface 1 — the context bar (replaces the debug panel)

A **full-width, single-line React row** rendered *between* the app bar and the terminal
border `View` in `terminal.tsx` (a real row, NOT a floating overlay — so it never
occludes output; costs ~28px). Reads one hook: `useShellContext(shellId)`.

**Three states** (inherited from the semantic-events status-chip spec):
- `off` — shell integration disabled for this host (or globally). The bar is hidden, or a
  faint "Smart terminal off" with a tap-to-settings. Keeps the terminal clean.
- `waiting` — integration on, no OSC seen yet. "Waiting for shell integration…" (rare now
  that we auto-inject; mostly only on shells/servers we couldn't inject — see the
  semantic-events delivery section).
- `active` — events flowing → the **product badge**: `cwd-basename · ⎇branch +dirty ·
  exit-pill · running-spinner|duration`. Exit pill red on non-zero.

**Tap → a details bottom sheet**: full cwd, full git status (changed-files list → git
doc), recent command list + exit codes, and the integration on/off control. This sheet is
where the git changed-files list and (later) per-command detail live.

This is the honest "is the smart layer working" signal *and* the ambient awareness
surface, in one row. It supersedes `components/TerminalSemanticsDebugPanel.tsx`.

## Surface 2 — the paged keyboard toolbar

Today `KeyboardToolbar` (`terminal.tsx`) is a fixed 2-row × 7-key grid (esc/nav/ctrl/alt)
in a ~100dp bar above the keyboard. Make it **horizontally paged**:

- **Page 1 — keys (default landing page):** the existing modifier/nav grid, *unchanged*.
  Always one swipe from anywhere; the toolbar always resets here on focus so muscle memory
  holds.
- **Page 2 — preset commands:** one-tap user commands → [preset-command-buttons.md](future/preset-command-buttons.md).
- **Page 3 — smart actions:** `✦ Ask AI`, `⎇ Changed files` (opens the git sheet), and an
  overflow `⋯`. Grows as features land.

**Mechanics (no new dependency):** a horizontal **paging `ScrollView`** (`pagingEnabled`,
each page = toolbar width) wrapping the three page contents, with a small page-dot row.
The toolbar sits *below* the terminal's `GestureDetector` column, so its horizontal swipe
does **not** conflict with the terminal's scroll/select gestures. All pages share the
existing `KeyboardToolBarContext` (`sendBytes`), so presets/actions send to the PTY
through the same path the keys already use. `react-native-reanimated` is available if we
want spring physics later, but `pagingEnabled` ScrollView is enough for v1.

## Surface 3 — bottom sheets (the deep views)

Summoned, never permanent. Reuse the app's existing `BottomSheet` (`KeyList.tsx` pattern:
`Modal` + slide + scrim + drag handle):
- **Ask-AI sheet** — streams the answer (AI doc); a text input + the assembled context.
- **Git sheet** — changed-files list, tap a file → diff peek (git doc). Also reachable by
  tapping the context bar.
- **Preset editor** — manage/add/reorder presets; long-press a preset on page 2 → edit
  sheet (mirror the host/session **rename** pattern we already shipped:
  `components/RenameDialog.tsx`).

## The production API: one canonical per-shell `ShellContext` store

There is no heavy new API — the seam is **promoting `terminal-semantics.ts` from a debug
feed into the canonical per-shell context store** every smart feature reads:

```ts
// src/lib/terminal-semantics.ts  (the store every smart surface subscribes to)
useShellContext(shellId): {
  // from the semantic-events pipeline (already wired: OSC 7/133/633):
  cwd?: string
  running: boolean
  lastCommand?: string
  lastExitCode?: number
  lastDurationMs?: number
  commandCount: number
  integration: 'off' | 'waiting' | 'active'   // derived: saw any OSC yet?
  // added by the git consumer (out-of-band exec, triggered by cwd/CommandFinished):
  git?: { branch: string; ahead: number; behind: number;
          staged: number; unstaged: number; untracked: number; files: GitFile[] }
}
```

- **Context bar** reads `cwd / git / running / lastExit / lastDuration / integration`.
- **Git** *writes* the `git` slice (its `exec` + porcelain parse) and *reads* `cwd` +
  `CommandFinished` as refresh triggers — see the git doc.
- **AI** reads the whole context + pulls the OSC-133 scrollback region for "the last
  command's output" (its prompt builder).
- **Presets** don't read context to *run* (they just `sendBytes(cmd + \r)`), but may read
  `running` to disable themselves mid-command (open question).

So the store stays the single source of truth; the three feature docs remain *consumers*
of it plus their own logic. The "integration" state field is the new derived bit the
context bar needs (we already track `firstSeen`-ish via the event log; formalize it).

## Feature → surface map

| Feature | Zone | Primary surface | Deep surface |
| ------- | ---- | --------------- | ------------ |
| Semantic status (cwd/exit/timing/running) | ambient | **context bar** | details sheet |
| Git status (branch/dirty) | ambient | **context bar** badge | git sheet (files, diff) |
| Preset commands | action | **toolbar page 2** | preset editor sheet |
| Ask-AI Q&A | action | **toolbar page 3** button | AI bottom sheet (stream) |
| AI autocomplete (later) | inline | ghost text near prompt | — |

> Presets also have a **second, off-terminal home**: a dedicated bottom-tab "Run" surface
> for one-off commands on a host *without* a persistent shell (out-of-band `exec`). That's
> owned by [preset-command-buttons.md](future/preset-command-buttons.md); this doc only
> covers the in-shell toolbar page.

## Suggested phasing

- **v0 — context bar (replaces debug panel). ✅ DONE.** Pure consumer of what already
  ships (cwd/exit/running/duration/lastCommand). No git, no AI. Deleted
  `TerminalSemanticsDebugPanel`. The home the other badges slot into. **Tap → details
  sheet** done (recent commands w/ exit + duration; the store now keeps a capped `recent`
  list). Shared `components/BottomSheet.tsx` extracted (KeyList reuses it).
  *Still TODO in v0:* a precise **per-host `off`** state — today the bar shows `waiting`
  when on-globally but a host had integration turned off (no OSC ever arrives). Fixing it
  means threading the effective per-shell `shellIntegration` value into the shell record so
  the bar can show `off` instead of a perpetual `waiting`. (The details sheet also has only
  a *hint* to Settings, not an inline integration toggle yet.)
- **v1 — paged toolbar + presets. ✅ DONE.** `KeyboardToolbar` is now a paging `ScrollView`:
  page 1 = the modifier/nav keys (unchanged), page 2 = preset commands, with page dots.
  Presets: `lib/presets.ts` (JSON-in-a-`definePref` store + CRUD), `PresetsToolbarPage`
  (tap = run via `sendBytes(cmd + \r)`, `+` = add, long-press = edit/delete, `autoRun`
  toggle). The **"Run" tab** (one-off `exec`, no shell) is still pending — needs the
  `fressh-ssh` `exec` helper (shared with git). See preset-command-buttons.md.
- **v1 — paged toolbar + presets.** Make the toolbar paged; ship page 2 (presets) since
  it's self-contained (no native work, no model, no out-of-band exec). High utility, low
  risk.
- **v2 — git slice.** Add the `exec` channel + porcelain parse (git doc) → git badge in
  the context bar + the git sheet. Page-3 "Changed files" action.
- **v3 — AI.** Page-3 "Ask AI" → context-assembled Q&A sheet (AI doc). Autocomplete later.

## Open questions

- **Context bar when off/empty.** Hide entirely, or always show a faint affordance so
  the feature is discoverable? Leaning: hidden when the global setting is off; a slim
  "waiting…" only when on-but-silent.
- **Toolbar page persistence.** Does the toolbar remember the last page, or always reset
  to keys on keyboard focus? Leaning reset-to-keys (muscle memory) with a quick swipe.
- **Page count creep.** Three pages is fine; if smart actions grow, page 3 becomes a grid
  / overflow rather than a 4th page.
- **Context bar vs native header.** We keep the native Stack header and add the bar below
  it. Confirm the bar doesn't fight the keyboard-avoidance math (`toolbarMarginBottom`) —
  it's above the terminal, so it shouldn't, but verify on device.
- **Landscape / small screens.** The context bar + paged toolbar both assume portrait
  width; check truncation (cwd basename only, ellipsize) and the toolbar page width.
