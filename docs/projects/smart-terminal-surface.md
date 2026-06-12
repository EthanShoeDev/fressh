# Project: smart-terminal surface — the production UI the smart features render into

**Status:** IN PROGRESS (updated 2026-06-12) — **context bar + paged toolbar + presets +
git badge all LANDED** (v0–v2 below). **Reopened** for the next surface question: the deep
views (changed-files, diff, and later AI) want **full-screen routes**, not just bottom
sheets. This doc is the presentation + consumer-API layer that turns the semantic-events
pipeline into product — it defines *where* each "smart terminal" feature lives and *what
shared store* they all read, so git / AI / preset-commands don't each reinvent placement
and plumbing.

**The reopen (2026-06-12, with Ethan):** the deep views started as bottom sheets (the
details sheet, the git readout). As they get richer — a real changed-files browser, a
structured diff, and an AI conversation — a summoned sheet is the wrong container. The
leaning is **keep the lightweight sheet for the quick peek AND add real routes for the deep
views** (see "Navigation: sheets vs. routes" below). *Not hard-committed* — we may explore
both and decide per-surface, or decide later.

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
[git-diff-integration.md](git-diff-integration.md),
[ai-integration.md](future/ai-integration.md),
[preset-command-buttons.md](complete/preset-command-buttons.md).

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
  the AI, open the changed-files list, peek a diff. → **Paged keyboard toolbar** to launch,
  then either a **quick bottom sheet** (a peek) or a **full-screen route** (the deep view).
  Which container each action uses is the "Navigation: sheets vs. routes" question below.

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

**Tap → a details bottom sheet**: full cwd, a git *summary* (branch/sync/counts), recent
command list + exit codes, and the integration on/off control. A glance, not a workspace —
the full changed-files list + diff move out to their own **routes** (git doc); the badge or
a "view changes" affordance here deep-links into that route.

This is the honest "is the smart layer working" signal *and* the ambient awareness
surface, in one row. It supersedes `components/TerminalSemanticsDebugPanel.tsx`.

## Surface 2 — the paged keyboard toolbar

Today `KeyboardToolbar` (`terminal.tsx`) is a fixed 2-row × 7-key grid (esc/nav/ctrl/alt)
in a ~100dp bar above the keyboard. Make it **horizontally paged**:

- **Page 1 — keys (default landing page):** the existing modifier/nav grid, *unchanged*.
  Always one swipe from anywhere; the toolbar always resets here on focus so muscle memory
  holds.
- **Page 2 — preset commands:** one-tap user commands → [preset-command-buttons.md](complete/preset-command-buttons.md).
- **Page 3 — smart actions:** `✦ Ask AI`, `⎇ Changed files` (opens the changed-files
  route), and an overflow `⋯`. Grows as features land.

**Mechanics (no new dependency):** a horizontal **paging `ScrollView`** (`pagingEnabled`,
each page = toolbar width) wrapping the three page contents, with a small page-dot row.
The toolbar sits *below* the terminal's `GestureDetector` column, so its horizontal swipe
does **not** conflict with the terminal's scroll/select gestures. All pages share the
existing `KeyboardToolBarContext` (`sendBytes`), so presets/actions send to the PTY
through the same path the keys already use. `react-native-reanimated` is available if we
want spring physics later, but `pagingEnabled` ScrollView is enough for v1.

## Surface 3 — the deep views (sheets *and* routes)

The deep views split by *weight*. Light, ephemeral, dismiss-with-a-swipe → a **bottom
sheet**. Heavy, navigable, want full width + a back stack → a **route** (an Expo Router
screen under `app/(tabs)/servers/`, the same place `diff.tsx` already lives).

**Bottom sheets (the quick peek)** — reuse the app's existing `BottomSheet` (`KeyList.tsx`
pattern: `Modal` + slide + scrim + drag handle):
- **Details sheet** — tap the context bar: cwd, recent commands + exit codes, integration
  toggle. A glance, not a workspace. Stays a sheet.
- **Preset editor** — manage/add/reorder presets; long-press a preset on page 2 → edit
  sheet (mirror the host/session **rename** pattern: `components/RenameDialog.tsx`). Stays
  a sheet.

**Routes (the deep view)** — full-screen `Stack` screens, native back/swipe-back:
- **Changed-files browser** — `servers/changes?shellId=…` (name TBD): grouped, status-
  glyphed file list. Pushes the diff route. (git doc §1.)
- **Diff view** — `servers/diff` (already exists, to be redesigned into a structured diff
  rather than a coloured dump). (git doc §2.)
- **AI** — leaning a route for the full conversation (`servers/ai?shellId=…`), with a quick
  sheet as a possible lighter entry. The route gives the chat room to breathe and a back
  stack, and is the cleaner home for a streamed, multi-turn exchange. (AI doc.)

See the next section for *why* the deep views move to routes and what's still open.

## Navigation: sheets vs. routes (the reopened question)

The original design (2026-06-08) put every deep view in a bottom sheet. That was right for
the *details peek* but is the wrong container as the git and AI views get rich:

- **A changed-files browser + a structured diff want full width and a back stack.** A diff
  with line-number gutters, intra-line highlighting, and (later) syntax colour is a
  reading surface, not a peek; cramming it into a 70%-height sheet wastes the screen and
  fights scrolling. A route gives full real estate and native swipe-back, and "browser
  pushes diff" is exactly what a `Stack` does for free.
- **It sets up AI cleanly.** An AI conversation is the clearest case for a route — a
  streamed, multi-turn exchange with its own scroll. Deciding the route pattern now (for
  git) means AI drops into the same shape later instead of re-litigating placement. This is
  the main reason to settle it as part of the git work.
- **Keep sheets for what they're good at.** The details peek and the preset editor are
  genuinely lightweight and *summoned over* the terminal — a route would be heavier than
  they deserve. So this isn't "routes replace sheets"; it's **sheet for the peek, route for
  the deep view.**

**Leaning (not committed):** the context-bar tap stays a details *sheet*; the "Changed
files" toolbar action and the AI action open *routes*. We may still prototype both
containers for a given surface before committing — see Open questions.

**Plumbing note:** routes live under `app/(tabs)/servers/` and take `shellId` as a param
(like `diff.tsx` does today), then read the shared `ShellContext` via
`useShellContext(shellId)` — so the route gets the same live cwd/git/context the in-place
sheet would, with no new store work. The only real cost over a sheet is that a pushed
route doesn't float *over* the terminal (it covers it); for the deep views that's fine —
you're reviewing, not typing.

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
| Semantic status (cwd/exit/timing/running) | ambient | **context bar** | details **sheet** (peek) |
| Git status (branch/dirty) | ambient | **context bar** badge | changed-files **route** → diff **route** |
| Preset commands | action | **toolbar page 2** | preset editor **sheet** |
| Ask-AI Q&A | action | **toolbar page 3** button | AI **route** (stream); maybe a quick sheet |
| AI autocomplete (later) | inline | ghost text near prompt | — |

> Presets also have a **second, off-terminal home**: a dedicated **"Commands" bottom tab**
> that both *manages* presets (CRUD) and *runs one-off commands* on a host without a
> persistent shell (out-of-band `exec`). That's owned by
> [preset-command-buttons.md](complete/preset-command-buttons.md); this doc only covers the
> in-shell toolbar page.

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
  toggle). The **"Commands" tab** (preset manager + one-off `exec` runner) is still pending — needs the
  `fressh-ssh` `exec` helper (shared with git). See preset-command-buttons.md.
- **v2 — git slice (plumbing + detection). ✅ DONE (2026-06-09).** JS porcelain parse over
  the shipped `runCommand` exec → `ShellContext.git` → git badge in the context bar + a
  debug file-list readout + a dump-style diff route. See the git doc.
- **v3 — the deep views become routes (NEXT).** Graduate the debug git readout into a real
  **changed-files browser route** + a redesigned **structured diff route**, and wire the
  page-3 "Changed files" action to open it. This is where the sheets-vs-routes decision
  above gets exercised for the first real deep view. Owned by the git doc (§1–§2); this doc
  owns the navigation pattern it establishes.
- **v4 — AI.** Page-3 "Ask AI" → a context-assembled Q&A **route** (streamed), reusing the
  route pattern v3 establishes (AI doc). Autocomplete later.

## Open questions

- **Sheets vs. routes, per surface (the reopened question).** Leaning: details = sheet,
  changed-files + diff + AI = routes (see "Navigation" above). *Not committed* — we may
  prototype both containers for a surface before deciding, or decide later. The forcing
  function is the git deep-view redesign (v3); whatever we settle there, AI inherits.
- **Deep-linking from the context bar.** If the details stays a sheet but the changed-files
  is a route, what's the affordance to jump sheet → route? A "View all changes" row in the
  sheet, the badge itself tappable, or both?
- **Route back-stack hygiene.** Pushed under `app/(tabs)/servers/` — confirm back-swipe
  returns to the terminal cleanly and the route survives a reconnect (it reads `shellId`
  from params + the live store, so a dropped shell should show an empty/"session gone"
  state, as `diff.tsx` already does).
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
