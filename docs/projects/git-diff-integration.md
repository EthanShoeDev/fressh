# Project: git-aware terminal — surface changed files in the cwd

**Status:** IN PROGRESS (2026-06-09) — **v1 (plumbing + detection) LANDED, verified on a
real device.** The git slice now flows end-to-end: cwd → out-of-band `git status` exec →
JS porcelain parse → `ShellContext.git` → a context-bar badge + a debug readout in the
details sheet. **No native (Rust) change was needed** — it's a pure consumer of the
already-shipped `runCommand` exec helper and the OSC-7 cwd. The richer changed-files UI
and the diff peek are the next phases; the original design record (kept below) predates
the implementation and over-estimated the work.

**Scope:** `apps/mobile` only (so far). The feature is entirely JS: a porcelain parser
(`lib/git-status.ts`), a driver hook (`lib/use-git-status.ts`), the `git` slice on the
shared `ShellContext` store (`lib/terminal-semantics.ts`), and rendering in the context
bar (`components/terminal/ContextBar.tsx`). It leans on two things that shipped first:
the `runCommand` out-of-band exec (`fressh-ssh` `Connection::exec_command`) and the OSC-7
cwd from the semantic-events pipeline.

**Prerequisite:** [terminal-semantic-events.md](complete/terminal-semantic-events.md) — the
shell-integration event pipeline (OSC 7 cwd, OSC 133 exit code) that lifts semantic
facts out of the native byte stream into JS. This feature is one consumer of it; the cwd
detection discussed below is really "the OSC 7 slice of that layer."

## What shipped (v1 — plumbing + detection)

The reality came out **simpler than the original "End-to-end flow" below**, because the
out-of-band exec helper and the OSC-7 cwd both shipped *before* this feature, so git
became a pure JS consumer rather than a new native event:

- **No Rust, no new `CoreEvent`.** The original plan (steps 2–3 below) parsed porcelain in
  Rust and emitted `CoreEvent::GitStatus`. Instead, JS calls the generic `runCommand`
  (`fressh-ssh` `Connection::exec_command` — a sibling, no-PTY session channel on the live
  connection) and parses the raw stdout in TypeScript. Git stays a *consumer* of the
  `ShellContext` store, exactly the role smart-terminal-surface assigns it.
- **Detection = the exit code of one `git status`.** `git -C '<cwd>' status
  --porcelain=v2 --branch -z` exits non-zero (and fast) outside a repo, so its exit code
  *is* the repo gate — no separate `rev-parse --is-inside-work-tree` round-trip. Non-zero
  ⇒ clear the slice ⇒ badge disappears. Degrades to invisible, never errors-noisy.
- **The cwd problem is sidestepped.** A sibling exec channel still can't see the
  interactive shell's cwd, but we don't need it to: we hold the cwd from OSC 7 and pass it
  explicitly with `git -C '<cwd>'` (single-quoted for spaces/quotes, since sshd runs the
  exec string through the login shell). This is the same model VS Code uses — git runs
  **out-of-band from the terminal**, not in the user's PTY (which belongs to whatever
  they're running, e.g. a coding agent).
- **Refresh trigger (v1 baseline): event-driven.** The driver hook re-probes on cwd change
  *and* after every finished command (`commandCount`), debounced 400ms. Cheap (one tiny
  exec) but chatty — it fires even after a no-op like `ls`. Tightening this (poll-only-
  while-running, or skip non-mutating commands) is the open refresh-policy question.
- **The pieces:**
  - `lib/git-status.ts` — pure `parsePorcelainV2()` (NUL-delimited records, type-2 renames
    that consume two fields, paths with spaces, detached HEAD, ahead/behind) +
    `gitStatusCommand()` + `shellSingleQuote()`. No RN imports.
  - `lib/terminal-semantics.ts` — `git?: GitStatus` on `ShellContext` + `setShellGit()`,
    which deliberately does **not** flip `sawOsc` (git isn't an OSC liveness signal).
  - `lib/use-git-status.ts` — `useGitStatusDriver(shellId)`, mounted by the context bar so
    git work only happens while a terminal is on screen; reads `connectionId` from
    ssh-store to fire the exec.
  - `components/terminal/ContextBar.tsx` — `GitBadge` (`⎇ main ↑2 ↓1 ●5`) in the bar +
    `GitSection` (branch/upstream/sync, counts, file list with raw XY codes) in the details
    sheet — a debug-grade readout standing in for the real files UI until it lands.

### Carried forward (designed, not built)

- **Real changed-files UI + diff peek.** Replace the debug `GitSection` with a proper
  files list; tap a file → `git diff -- <file>` via another `runCommand`, rendered in the
  git bottom sheet (the surface smart-terminal-surface reserves). Diff *rendering*
  (syntax/colour) is the hard UI part — start with a plain/monospace debug view.
- **A smarter refresh policy** than "after every command" (see above).
- **Write operations — commit / push / pull.** Each is just another `runCommand`
  (`git -C … add` / `commit -m '<msg>'` / `push`). This is the genuinely phone-shaped
  workflow when driving an agent (review the diff, write a message, push) but it's a real
  scope jump from read-only glance → mobile git client, with its own surface (staging,
  message input) and edges (push needs host-side credentials; keep to the non-interactive
  subset). Its own later phase.
- **Why VS Code's instant freshness isn't free for us.** VS Code's git runs in its
  ~100 MB host **server** as a child process and refreshes via an **inotify file-watcher**
  on `.git`/the worktree — push-based, catches an agent's mid-run writes instantly. We
  deliberately have *no* host-side process (we own the SSH transport directly), so we can't
  get that without reinventing a piece of the server (a long-lived `inotifywait` exec
  channel, fragile). Our honest options are event-driven or polled. Worth stating plainly.
- **Adjacent (separate feature): a multi-shell session switcher.** The store already
  models N shells per connection; what's missing is UI to open/switch them. Useful for
  *doing things alongside* a running agent, but **not** needed for the git glance (that
  uses the exec channel). Track it on its own, not coupled to git.

## The idea

A meaningful chunk of this app's users will SSH into a remote box to drive a **coding
agent** (Claude Code, etc.) or just to hack on code. When the shell's current working
directory is a git repo, we could render **special UI around the changed files** —
a glanceable summary of `git status`: branch, ahead/behind, staged/unstaged/untracked
counts, maybe a tappable list of changed files, maybe a diff peek.

The mental model: the terminal is for *typing*; a thin git affordance on top is for
*situational awareness* while an agent (or you) churns the working tree. On a phone,
where you can't keep a second pane of `git status` open, that ambient signal is worth
more than it is on desktop.

## Is it possible? Yes — and our architecture helps

Three things have to work: **(1)** know the shell's cwd, **(2)** run `git` against it
without disturbing the interactive session, **(3)** render an overlay. We already have
most of the scaffolding.

### (2) Running git out-of-band — the easy part

We use **russh** (`fressh-ssh/src/connection.rs`), one TCP connection per host. A shell
is just a channel: `open_shell()` does `handle.channel_open_session()` +
`request_pty()` (connection.rs:133-163). russh multiplexes **many channels over one
connection**, so we can open a *second* channel — **without** a PTY — run a single
command (`git status --porcelain=v2 --branch -z`), capture stdout, and close it. The
interactive shell's PTY never sees any of it. No extra TCP connect, no auth re-prompt,
reuses the live `Connection`.

What's missing today: `fressh-ssh` only exposes `open_shell` (PTY + interactive shell).
We'd add an `exec(cmd) -> output` helper (a `channel_open_session` then `channel.exec()`
instead of `request_shell()`). Small, self-contained addition.

> Note: prefer `--porcelain=v2 -z` (stable, machine-readable, NUL-delimited) over
> scraping human `git status`. It gives branch, upstream, ahead/behind, and per-file
> XY status in one shot.

### (1) Knowing the cwd — the genuinely hard part

This is where it gets interesting, because of a deliberate architectural choice: the
**high-frequency terminal byte stream feeds `Term` natively and never crosses to JS**
(`fressh-core/src/events.rs` header; the native-rendering-refactor doc §10 data plane).
JS sees only low-frequency `CoreEvent`s (connect progress, host-key, close). So "what
is the cwd right now" is *not* sitting in a JS variable we can read.

Options for learning the cwd, roughly easiest → most robust:

- **A. Ask out-of-band.** On the second channel, the cwd of a *new* exec channel is the
  SSH login dir — **not** the interactive shell's cwd after the user `cd`s around. A
  fresh channel has no idea where the interactive shell currently is. So a naive
  `cd && git status` on a second channel reports the wrong directory. This is the core
  difficulty: **the cwd lives inside the interactive shell's process, and a sibling
  channel can't see it.** Workarounds:
    - Read `/proc/<pid>/cwd` of the shell — but we don't reliably know the remote PID,
      and it's Linux-only.
    - Inject `pwd` into the interactive shell and scrape it back — invasive, races with
      the user's typing, pollutes scrollback. Reject.

- **B. OSC 7 (the right answer, needs the parser).** OSC 7 is the standard "report cwd"
  escape sequence: shells emit `ESC ] 7 ; file://host/path ST` on every prompt /
  directory change. Most shells support it with a one-line hook (bash/zsh
  `PROMPT_COMMAND`, fish `$PWD` handler; starship and many prompt frameworks emit it
  automatically). **The catch:** OSC 7 arrives *in the byte stream*, which is exactly
  the stream that stays native and never reaches JS. So we'd hook the **vte/alacritty
  parser** in `fressh-core/src/session.rs` (`CoreListener`) to catch the OSC, extract
  the path, and emit a **new** `CoreEvent::WorkingDirectoryChanged { shell_id, path }`.
  Today `CoreListener` only reacts to `Event::PtyWrite`; alacritty's vte already parses
  OSC, so this is "handle one more OSC case," not "write a parser."

- **C. OSC 133 / semantic prompt markers (bonus).** Shell-integration sequences mark
  prompt/command/output regions. Overkill for v1, but the same hook point — worth
  knowing it's there if we later want "git status as of the last command."

**Reality check:** B requires either (i) the user's remote shell already emits OSC 7
(common with modern prompts — starship, oh-my-zsh themes, fish), or (ii) we document a
one-line rc snippet, or (iii) we offer to install the hook. Without OSC 7 there is no
clean, non-invasive way to track an interactive shell's cwd. That's not a fressh
limitation — it's true of every terminal; this is why iTerm2/VS Code/WezTerm all rely
on shell integration for cwd-aware features.

### (3) Rendering the overlay — already a solved pattern

> **Where it renders is now decided:** the git badge (branch + dirty count) lives in the
> **context bar**, and the changed-files list / diff peek open in a **bottom sheet** — see
> [smart-terminal-surface.md](../smart-terminal-surface.md). Git *writes* the `git` slice
> of the shared `ShellContext` store; the context bar reads it. The exec helper below is
> shared with [preset-command-buttons.md](preset-command-buttons.md)'s "Commands" tab.


The terminal screen is a native Nitro/GLES view, but the app already floats **React
overlays** over it: the copy button and the modifier-key toolbar in
`apps/mobile/src/app/(tabs)/servers/terminal.tsx`. A git affordance is the same shape —
a React component positioned over the terminal, fed by a new event, hidden when there's
no repo. No renderer work needed.

## End-to-end flow (original design — superseded by "What shipped", kept for rationale)

> **What actually shipped is simpler** — see the "What shipped (v1)" section at the top.
> The Rust parse + new `CoreEvent::GitStatus` below were unnecessary: `runCommand`
> returns raw stdout to JS, so detection + porcelain parse both live in TypeScript, and
> the cwd is passed explicitly via `git -C` rather than learned inside `fressh-core`.

1. Parser (`session.rs` `CoreListener`) catches **OSC 7** → emits
   `CoreEvent::WorkingDirectoryChanged { shell_id, path }`.
2. `fressh-core` (debounced) opens a **no-PTY exec channel** on the same connection and
   runs `git -C <path> status --porcelain=v2 --branch -z` (+ `git rev-parse
   --is-inside-work-tree` to gate). Add an `exec()` to `fressh-ssh`.
3. Parse the porcelain output in Rust → emit `CoreEvent::GitStatus { shell_id, branch,
   ahead, behind, files: [...] }`.
4. JS (`src/ssh.ts` event bridge → `ssh-store.ts`) stores per-shell git state.
5. A React overlay in `terminal.tsx` renders the badge / changed-files list; tap a file
   → (later) peek its diff via another `exec` (`git diff -- <file>`).

Steps 2-3 can also be a **manual refresh button** for v0, sidestepping OSC 7 entirely
to prove the UI — but it'd be stuck reporting the login dir until cwd tracking lands.

## Suggested phasing

- **v0 (proof):** ~~Manual "git" button → out-of-band `exec`~~ — **skipped.** The exec
  helper + OSC-7 cwd both shipped first, so there was no need for a cwd-less proof step.
- **v1 (real): ✅ DONE (2026-06-09, on-device).** OSC 7 cwd → debounced out-of-band `git
  status` → JS porcelain parse → `ShellContext.git` → context-bar badge (branch +
  ahead/behind + dirty count) + a debug file-list readout in the details sheet. Refresh is
  event-driven (cwd change + every `CommandFinished`). See "What shipped (v1)" up top.
- **v2 (in progress): diff route ✅ + richer files UI.** **Diff route LANDED
  (2026-06-09):** tapping a file in the context-bar git readout pushes
  `servers/diff?shellId=…&file=…` (`app/(tabs)/servers/diff.tsx`), which runs `git diff
  HEAD -- <file>` (or `--no-index /dev/null <file>` for untracked) over `runCommand` and
  renders a plain monospace, +/- coloured unified diff (`lib/git-diff.ts` =
  command-builder + line classifier, pure like git-status.ts). This is the "debug route"
  quality agreed for v2 — real diff *rendering* (syntax, intra-line) comes later. Still
  TODO: graduate the debug `GitSection` into a proper changed-files surface, and a smarter
  refresh policy than "after every command."
- **v3 (later): write ops** — commit / push / pull, each a one-shot `runCommand`. The
  read→write jump to a mobile git client; its own surface + edges. See "Carried forward."

## Open questions

- **Polling vs. event-driven (v1 = event-driven; still open for v2).** v1 refreshes on cwd
  change + every `CommandFinished` (debounced) — no timer. This catches an agent's writes
  when it *returns*, but not *while* it runs (the shell draws no prompt mid-run, so no
  events fire). Open: poll `git status` on an interval *only while a command is running*
  (the agent-churn window) and stop at idle? One tiny exec / few seconds is cheap; the
  question is whether mid-run freshness is worth the chattiness for v2.
- **Shell-integration friction.** What's our story for users whose prompt doesn't emit
  OSC 7? Detect-and-suggest? An opt-in "enable git features" that appends a hook to
  `~/.bashrc`? (Writing to a user's rc file is invasive — needs consent UX.)
- **Cost of being wrong about the repo.** Bare `git -C <path>` is safe; gate on
  `--is-inside-work-tree` so we never render git UI for non-repos.
- **Worktrees / submodules / huge repos.** `status` on a giant tree can be slow; cap it,
  or use `--untracked-files=normal` and a timeout.
- **Non-Linux / non-git remotes.** Feature must degrade to invisible, never error-noisy.
- **Security.** We'd be executing `git` on the remote on the user's behalf. It's their
  own authenticated session running a read-only command in their own dir — low risk —
  but worth stating: no writes, no `git config` mutation, read-only porcelain only.

## Why this fits fressh specifically

The "SSH-in-to-drive-an-agent" workflow is phone-shaped: you can't tile windows, and you
want to *watch* the working tree change without typing `git status` every ten seconds.
A native, ambient git affordance is exactly the kind of thing a mobile SSH client can do
that a desktop terminal user would just solve with a second pane. The hard part is cwd
tracking, and the honest answer is "OSC 7 + a parser hook" — which our architecture
already has the right seam for (`CoreListener` + the `CoreEvent` plane).
