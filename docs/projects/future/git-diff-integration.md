# Future project: git-aware terminal — surface changed files in the cwd

**Status:** NOT STARTED — exploratory. This is a "could we?" discussion doc, not a
plan. It records the idea, what's feasible given our architecture, the hard parts,
and the design options so we don't re-derive them.

**Scope (if pursued):** `@fressh/react-native-terminal` (`fressh-core` + `fressh-ssh`,
possibly the vendored alacritty parser) + the mobile app's terminal UI.

**Prerequisite:** [terminal-semantic-events.md](terminal-semantic-events.md) — the
shell-integration event pipeline (OSC 7 cwd, OSC 133 exit code) that lifts semantic
facts out of the native byte stream into JS. This feature is one consumer of it; the cwd
detection discussed below is really "the OSC 7 slice of that layer."

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

The terminal screen is a native Nitro/GLES view, but the app already floats **React
overlays** over it: the copy button and the modifier-key toolbar in
`apps/mobile/src/app/(tabs)/servers/terminal.tsx`. A git affordance is the same shape —
a React component positioned over the terminal, fed by a new event, hidden when there's
no repo. No renderer work needed.

## End-to-end flow (if we build option B)

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

- **v0 (proof):** Manual "git" button → out-of-band `exec` `git status` in the login
  dir → overlay renders counts. Validates the exec channel + UI with zero parser work.
  Honestly label the cwd limitation.
- **v1 (real):** OSC 7 → `WorkingDirectoryChanged` → auto `git status` on cd, debounced.
  Branch + ahead/behind + changed-file list. Refresh on a timer or on prompt.
- **v2 (nice):** Tap a file → diff peek. OSC 133 to refresh exactly when a command
  finishes (catches the agent's writes the instant it stops).

## Open questions

- **Polling vs. event-driven.** A coding agent changes files *between* prompts, so cwd
  events alone won't catch mid-run edits. Do we poll `git status` on an interval while a
  repo is active? How cheap is that over SSH (one tiny exec / few seconds)? OSC 133
  "command finished" is the elegant trigger but needs more shell integration.
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
