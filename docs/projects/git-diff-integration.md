# Project: git-aware terminal — surface changed files + a real diff view

**Status:** IN PROGRESS (updated 2026-06-12). **Detection + a debug-grade diff both
shipped and are verified on a real device.** The git slice flows end-to-end: cwd →
out-of-band `git status` exec → JS porcelain parse → `ShellContext.git` → a context-bar
badge + a changed-files readout + a tap-through diff route. **No native (Rust) change was
ever needed** — git is a pure JS consumer of the already-shipped `runCommand` exec helper
and the OSC-7 cwd.

**What's left is the part this doc now focuses on:** turn the debug-grade pieces into a
real *git experience* — a proper **changed-files browser** (a good way to pick the file
you want) and a real **diff view** (structured rendering, not a coloured text dump), both
as **their own routes**. See "What's next" below.

**Scope:** `apps/mobile` only — the feature is entirely JS. It leans on two things that
shipped first: the `runCommand` out-of-band exec (`fressh-ssh` `Connection::exec_command`)
and the OSC-7 cwd from the semantic-events pipeline.

**Prerequisite:** [terminal-semantic-events.md](complete/terminal-semantic-events.md) — the
shell-integration pipeline (OSC 7 cwd, OSC 133/633 command lifecycle) that lifts semantic
facts out of the native byte stream into JS. Git is one consumer; the cwd it needs is the
OSC-7 slice of that layer.

**Surface / navigation:** [smart-terminal-surface.md](smart-terminal-surface.md) owns
*where* the git UI lives (context-bar badge, the quick details sheet, and the full routes)
and the route-vs-sheet decision the diff/browser work depends on.

---

## What shipped (the foundation — kept brief on purpose)

The reality came out **much simpler than the original design** (preserved in git history;
trimmed from this doc 2026-06-12). The out-of-band exec helper and the OSC-7 cwd both
shipped *before* this feature, so git became a pure JS consumer rather than a new native
`CoreEvent`. The key facts worth keeping:

- **No Rust, no new event.** JS calls the generic `runCommand` (a sibling, no-PTY exec
  channel on the live connection) and parses raw stdout in TypeScript.
- **Detection = one `git status`'s exit code.** `git -C '<cwd>' status --porcelain=v2
  --branch -z` exits non-zero (fast) outside a repo, so its exit code *is* the repo gate —
  no separate `rev-parse`. Non-zero ⇒ clear the slice ⇒ badge disappears. Degrades to
  invisible, never errors-noisy.
- **The cwd is passed explicitly.** A sibling exec channel can't see the interactive
  shell's cwd, so we hold the OSC-7 cwd and pass it with `git -C '<cwd>'` (single-quoted).
  Same model VS Code uses — git runs out-of-band from the terminal, not in the user's PTY.
- **Refresh is event-driven.** The driver re-probes on cwd change *and* after every
  finished command (`commandCount`), debounced 400ms. Cheap but chatty (fires even after a
  no-op `ls`). Tightening this is an open question (below).

**The shipped pieces:**
- `lib/git-status.ts` — pure `parsePorcelainV2()` (NUL-delimited records, type-2 renames,
  paths with spaces, detached HEAD, ahead/behind) + `gitStatusCommand()` +
  `shellSingleQuote()`. No RN imports.
- `lib/git-diff.ts` — pure `gitDiffCommand()` (working-tree-vs-`HEAD` for tracked,
  `--no-index /dev/null` for untracked) + `classifyDiffLine()`. No RN imports.
- `lib/terminal-semantics.ts` — `git?: GitStatus` on `ShellContext` + `setShellGit()`.
- `lib/use-git-status.ts` — `useGitStatusDriver(shellId)`, mounted by the context bar so
  git work only happens while a terminal is on screen.
- `components/terminal/ContextBar.tsx` — `GitBadge` (`⎇ main ↑2 ↓1 ●5`) in the bar +
  `GitSection` (branch/upstream/sync, counts, a tappable file list with raw XY codes) in
  the details sheet. **Debug-grade** — the thing this doc's next phase replaces.
- `app/(tabs)/servers/diff.tsx` — the diff route. Tapping a file pushes
  `servers/diff?shellId=…&file=…`, runs `git diff HEAD -- <file>` over `runCommand`, and
  renders a plain monospace, +/- coloured unified diff with a 3000-line cap. **A coloured
  text dump** — also what the next phase replaces.

---

## What's next (the focus of this doc)

Two real screens, each its own route, plus a refresh-policy decision. The debug
`GitSection` and the dump-style `diff.tsx` are the stand-ins they graduate.

### 1. The changed-files browser (a real route, "pick a file to diff")

Today the only way to pick a file is the cramped, scrollable `GitSection` list buried in
the details bottom sheet, showing raw `XY` porcelain codes. Replace it with a **dedicated
route** — `servers/changes?shellId=…` (name TBD) — reachable from the context-bar git
badge and the toolbar page-3 "Changed files" action (per the surface doc). What it should
do that the debug list doesn't:

- **Group by state:** Staged · Unstaged · Untracked · Conflicted, each a labelled section,
  instead of one flat list with `MM`/`??` codes the user has to decode.
- **Human status, not raw XY:** a glyph + word (Modified / Added / Deleted / Renamed /
  Untracked) and a colour, derived from the porcelain `x`/`y` we already parse.
- **Per-file change size:** `+N −M` line counts from `git diff --numstat` (one extra
  out-of-band exec; pairs naturally with the status probe). A cheap, high-signal glance.
- **Path treatment:** ellipsize sensibly (basename emphasised, dir muted), handle renames
  (`old → new`), and consider a **directory-tree vs flat-list** toggle for large repos.
- **Tap → the diff route.** Long-press → (later) per-file actions (stage/unstage/discard —
  see write-ops, deferred).

Open: is this route the *same* surface as the diff (a master-detail that pushes the diff),
or a sibling? On a phone, leaning **two routes** (list pushes diff) so each gets full width
and the native back stack does the right thing. Confirm against the surface doc's
route-vs-sheet exploration.

### 2. The real diff view (a route, structured rendering — not a text dump)

`diff.tsx` today splits stdout on `\n` and colours each line green/red/blue — it's a
**dump with colouring**, which is the explicitly-agreed debug quality. The real view should
*parse the unified diff into a structured model* and render from that:

- **Parse, don't classify.** Turn `git diff` output into `{ files: [{ hunks: [{ oldStart,
  newStart, lines: [{ kind, oldNo?, newNo?, text }] }] }] }`. Once it's structured we can
  render gutters and intra-line diffs that per-line classification can't. (Keep the parser
  pure + unit-tested, like `git-status.ts`/`git-diff.ts`.)
- **Old/new line-number gutters** — two columns, the standard diff affordance, impossible
  from the current flat line list.
- **Intra-line (word-level) highlighting** — within a changed line, emphasise the bytes
  that actually differ, not the whole line. The single biggest readability win over a dump.
- **Syntax highlighting** by file extension. **This is the real open question** — RN has no
  free lunch here (the terminal is native GLES; this screen is ordinary RN `<Text>`).
  Options to weigh: a JS tokenizer (Prism/`highlight.js`/Shiki-in-JS) feeding styled
  `<Text>` spans, vs. a hidden `WebView` (heavy, but gets a real highlighter for free), vs.
  ship line-level diff first and layer syntax on later. Lean: structured + intra-line +
  gutters first; syntax highlighting as a follow-up so it doesn't block the redesign.
- **Unified vs side-by-side** — unified is the phone-shaped default; a side-by-side toggle
  is a maybe-later (narrow screens make it rough).
- **Big-diff handling** — keep a cap, but virtualize (`FlashList`/windowing) instead of the
  blunt 3000-line slice, and let the user expand/collapse hunks and unchanged context.
- **Staged vs working-tree** — today we diff `HEAD` (staged + unstaged combined). With the
  grouped browser we may want to diff the *specific* state the file was tapped in (a staged
  entry → `git diff --cached`, an unstaged one → `git diff`). Decide alongside the browser.

### 3. A smarter refresh policy

v1 refreshes on cwd change + every `CommandFinished` (debounced) — no timer. This catches
an agent's writes when it *returns*, but not *while* it runs (no prompt is drawn mid-run,
so no events fire). Options: poll `git status` on an interval **only while a command is
running** (the agent-churn window) and stop at idle. One tiny exec every few seconds is
cheap; the question is whether mid-run freshness is worth the chattiness.

> **Why VS Code's instant freshness isn't free for us.** VS Code's git runs in its
> ~100 MB host **server** and refreshes via an **inotify watcher** on `.git` — push-based,
> catches mid-run writes instantly. We deliberately have *no* host-side process (we own the
> SSH transport directly), so our honest options are event-driven or polled, not watched.

### 4. Write operations — commit / push / pull (a later phase)

Each is just another `runCommand` (`git -C … add` / `commit -m '<msg>'` / `push`). This is
the genuinely phone-shaped agent workflow (review the diff, write a message, push) but it's
a real scope jump from read-only glance → mobile git client, with its own surface (staging
UI, message input) and edges (push needs host-side credentials; keep to the
non-interactive subset). Its own later phase, after the read-only browser + diff land.

---

## The idea (why this fits fressh)

A meaningful chunk of this app's users SSH into a remote box to drive a **coding agent**
(Claude Code, etc.) or to hack on code. The "SSH-in-to-drive-an-agent" workflow is
phone-shaped: you can't tile windows, and you want to *watch* the working tree change —
and actually *read the diffs* — without typing `git status` / `git diff` every ten
seconds. The terminal is for *typing*; a real git affordance on top is for *situational
awareness and review*. That's exactly the thing a mobile SSH client can do that a desktop
terminal user would just solve with a second pane.

## Open questions

- **Browser ↔ diff routing.** Two routes (list pushes diff) vs. one master-detail surface;
  tie to the surface doc's route-vs-sheet exploration. Leaning two routes.
- **Syntax highlighting in RN.** JS tokenizer → styled `<Text>` vs. hidden WebView vs.
  defer. The main unknown in the real diff view. Leaning: defer; ship structure + gutters +
  intra-line first.
- **Refresh: event-driven vs. poll-while-running** (see §3). Open for the next phase.
- **Which diff state to show** — combined `HEAD` vs. staged-only / unstaged-only, driven by
  how the file was selected in the browser (§2 last bullet).
- **Shell-integration friction.** Git needs OSC-7 cwd, so it inherits the prereq's gate:
  what's the story for shells that don't emit it? (Auto-injection covers the common case;
  see the semantic-events doc.) Degrade to invisible.
- **Big repos / slowness.** `status` + `numstat` + `diff` on a giant tree can be slow; cap,
  timeout, and virtualize. Never block the terminal.
- **Security.** Read-only porcelain/diff on the user's own authenticated session in their
  own dir — low risk. No writes, no `git config` mutation, until the write-ops phase (which
  gets explicit per-action UX).
