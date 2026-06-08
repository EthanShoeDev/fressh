# Project: terminal semantic events → JS (shell integration)

**Status:** FIRST SLICE LANDED (2026-06-08) — the pipeline exists and is verified
end-to-end on a real device. OSC 7 (cwd) + OSC 133 A/B/C/D (prompt/command lifecycle +
exit code + duration) are parsed natively and delivered to JS. The foundational
capability that several "smart terminal" features (git-aware UI, exit-code badges,
command timing) all sit on. See [git-diff-integration.md](git-diff-integration.md) and
[ai-integration.md](future/ai-integration.md) — those features are *consumers* of this
pipeline.

**What's built:**
- `fressh-core/src/osc.rs` — `OscScanner` (`vte::Perform`) over a second `vte::Parser`
  in the reader loop; emits the four `CoreEvent` variants below. Unit-tested.
- `events.rs` / `shim-uniffi` / regenerated ubrn bindings — the events cross to JS via
  the existing `addFresshEventListener` plane.
- `apps/mobile`: `lib/terminal-semantics.ts` (per-shell Zustand store + capped event
  log) and `components/TerminalSemanticsDebugPanel.tsx` (a visible debug overlay with a
  "Emit test OSC" button that round-trips `printf '\033]7…' "$PWD"` through the real
  scanner — used to verify the seam without depending on remote shell config).

**What's NOT built yet** (this doc's remaining work): the shell-integration *delivery*
(settings toggle + install/instructions), the *detection* UI on the terminal view, and
the product surface that replaces the debug panel. See "Shell integration" below.

**Scope:** `@fressh/react-native-terminal` — `fressh-core` (`session.rs` reader loop,
`osc.rs`, `events.rs` `CoreEvent`), the shim (`shim-uniffi/src/lib.rs`), the JS event
bridge (`src/ssh.ts`), and the mobile app's terminal UI + settings.

**Scope (if pursued):** `@fressh/react-native-terminal` — the vendored alacritty parser
+ `fressh-core` (`session.rs` `CoreListener`, `events.rs` `CoreEvent`), the shim
(`shim-uniffi/src/lib.rs`), and the JS event bridge (`src/ssh.ts`).

## The idea

Extract **semantic information** from the terminal stream — "the last command exited
non-zero", "the cwd changed", "a command started/finished", "this command took 4.2s" —
and surface it to the React/JS side so the app can render custom UI (an error badge, a
git panel, a running-spinner, command history). Today the byte stream feeds the native
`Term` and JS sees almost none of its meaning.

This is **not** one feature; it's the *seam* that makes a whole class of features cheap.
Once the pipe exists, each new signal is "parse one more escape sequence + add one event
variant," not "re-architect the data flow."

## The data-flow problem (and why it's already mostly solved)

A deliberate architecture choice (native-rendering-refactor §10): the **high-frequency
byte stream feeds `Term` natively and never crosses to JS.** Only **low-frequency**
`CoreEvent`s do. That's correct for performance — we do NOT want every byte hopping the
FFI boundary — but it means semantic facts buried in the stream aren't visible to React
until we explicitly lift them out.

The good news: **the lifting mechanism already exists and is battle-tested.** The
one-way event plane that carries connect-progress and host-key prompts today is exactly
the pipe we extend:

```
fressh_core::CoreEvent              events.rs          — the enum (add variants here)
  → EventSink trait                 events.rs          — installed sink
  → SinkBridge::emit                shim-uniffi/lib.rs:220
  → From<CoreEvent> for FresshEvent shim-uniffi/lib.rs:193  — map to the FFI type
  → uniffi callback interface       (generated)
  → FresshEventListener.onEvent     src/ssh.ts:160     — single fan-out listener
  → subscribers Set                 src/ssh.ts:153
  → addFresshEventListener(cb)      src/ssh.ts:170     — returns unsubscribe; React subscribes
```

React side is a plain subscription — **not** `useImperativeHandle` (that's for a parent
reaching into a child; wrong direction). A component does:

```ts
useEffect(() => addFresshEventListener((ev) => {
  if (ev.tag === FresshEvent_Tags.CommandFinished && ev.exitCode !== 0) setError(ev);
}), []);
```

## Decision (resolved 2026-06-08): a low-level `vte::Perform` side-scanner, no fork

The original framing of this doc — *"vte already parses OSC; alacritty already routes
it; just handle the OSC cases in `CoreListener`"* — **is wrong**, and verifying that
drove the implementation decision. The facts, confirmed against the real sources:

- `alacritty_terminal` is the **published `=0.26.0` crate, deliberately NOT a fork**
  (the rust workspace manifest is explicit: pinned exact + unified to one `Term`
  instance with the renderer fork). Its ANSI parsing lives in **`vte 0.15.0`**.
- vte has **two API layers**:
  - **High-level** (`vte::ansi::Processor` + the `ansi::Handler` trait) — what
    alacritty's `Term` uses. Its `osc_dispatch` (`vte` `ansi.rs`) routes recognized OSCs
    to typed `Handler` methods (title, color, clipboard, hyperlink…) and sends **OSC 7
    and OSC 133 to a `_ => unhandled` debug-log arm.** There is no `set_current_directory`
    / shell-integration method, so `Term` never produces an `Event` for them, so
    `CoreListener` (an alacritty `EventListener`) can *never* observe them. The hook
    point the doc proposed cannot see the data.
  - **Low-level** (`vte::Parser` + the `vte::Perform` trait, `vte` `lib.rs`) — the raw
    state machine. Its `Perform::osc_dispatch(&mut self, params: &[&[u8]], bell_terminated)`
    fires for **every** OSC including 7 and 133, with empty default methods for
    everything else.

**Two ways to surface 7/133 were considered:**

- **B. Fork vte + `alacritty_terminal`.** Add `Handler` methods + dispatch arms to vte
  (vte is *not* forked today — new vendored crate), switch `alacritty_terminal` to the
  vendored fork via `[patch.crates-io]`, add `Event` variants, implement the handlers on
  `Term`. ~40–60 lines across two crates — but the cost was never diff size; it's a
  **permanent lockstep-rebase burden** (vte patch + engine patch + renderer fork, all
  bumped together on every engine upgrade) and it abandons the deliberate "engine is the
  published crate" decision. Contradicts the minimize-fork-divergence guideline.

- **A. ✅ CHOSEN — a low-level `vte::Perform` side-scanner in `fressh-core`.** Run a
  *second* `vte::Parser` (reached as `alacritty_terminal::vte::{Parser, Perform}` — it's
  `pub use vte;`, so **no new dependency**) over the same bytes in the reader loop, with
  a ~20-line `Perform` that overrides only `osc_dispatch` to match `b"7"` and `b"133"`.
  vte does all the real parsing — ESC/CSI/OSC framing, UTF-8, BEL-vs-ST terminators,
  **sequences split across network chunks** (its `advance` is built for streaming), max
  OSC buffer. We are **not hand-rolling a parser** and **not forking anything**; vte is
  the ready-made lib, used at the layer that actually exposes the data. Self-contained in
  `fressh-core`, unit-testable in pure Rust, no binding-regen/build-graph risk.

Both A and B can serve every downstream consumer — cwd, exit code, command lifecycle,
and even the AI feature's hardest need (slicing scrollback into *the last command's
output*): the scanner controls its own `advance()` calls, so on spotting a marker at
byte offset *N* it can `advance(bytes[..N])`, read `term.grid().cursor.point.line`, then
`advance(bytes[N..])` to correlate a marker with a grid row — without owning the parser.
The only thing that would have flipped the decision to B is a needed signal derivable
*only* from deep internal parser state unreachable from bytes + cursor position; across
the three consumer docs there isn't one.

### Performance: the second parser is cheap

The byte stream already runs one vte parser (`processor.advance` → `Term`). The scanner
adds one more pass over the same bytes, but the two are not equal cost:

- vte's `Parser` is a byte-at-a-time, table-driven state machine; **no allocation** in
  the common path (the OSC raw buffer only fills *inside* an OSC string — rare).
- Our `Perform` is empty for everything but `osc_dispatch`; the no-op methods inline
  away, so for ~99.9% of bytes the scanner is just a state transition.
- **All expensive terminal work — grid mutation, reflow, damage — stays in the first
  parser+`Term`, untouched.** The scanner does none of it; it's the cheap half of one
  parser, not a second `Term`.
- It needs **no `Term` lock** (it only emits events), so it doesn't lengthen the existing
  critical section. ~1 KB state per shell.

Net cost ≈ a memcpy-speed scan, dwarfed by the per-chunk grid work already happening. A
`memchr` early-out (skip ground-state chunks with no `0x1b`) is available if ever needed,
but is premature.

## Where the semantics come from: OSC / shell-integration sequences

The signals we want are **standard escape sequences** a shell emits when configured for
shell integration (a.k.a. "semantic prompt"). They arrive in the byte stream and are
parsed by vte's low-level `Parser`. We catch them in **one place** — the `OscScanner`
(`vte::Perform`) driven from the reader loop in `fressh-core/src/session.rs`, alongside
the existing `processor.advance` that feeds `Term`:

| Signal                         | Sequence                         | Gives us |
| ------------------------------ | -------------------------------- | -------- |
| cwd changed                    | `OSC 7 ; file://host/path ST`    | current directory (git project) |
| prompt start                   | `OSC 133 ; A ST`                 | new prompt drawn |
| command start (user hit enter) | `OSC 133 ; B ST` / `C`           | a command is running now |
| **command finished + status**  | `OSC 133 ; D ; <exit_code> ST`   | **exit code** (the thing you asked about) |
| command text (optional)        | `OSC 133 ; ... ; cmdline`        | what ran (for history) |

`OSC 133 ; D ; <code>` is literally "the last command exited with `<code>`" — fires the
instant it finishes. Pair `B`→`D` timestamps and you also get **command duration** for
free.

vte's **low-level `Parser` already does all OSC framing** — including 7 and 133, which
the *high-level* `ansi::Handler` layer (alacritty's `Term`) discards. The work is
implementing `osc_dispatch` on our own `Perform` for these specific OSC numbers — not
writing a parser, and not forking one. See the Decision section above for why the
high-level `CoreListener` path can't see these and the low-level `Perform` can.

## End-to-end work to add (e.g.) "last command failed"

1. **Scanner arm** — in the `OscScanner`'s `osc_dispatch` (`fressh-core`), match
   `params == [b"133", b"D", code?]` → `events::emit(CoreEvent::CommandFinished {
   shell_id, exit_code, duration_ms })`. The scanner is driven from the `session.rs`
   reader loop next to `processor.advance`.
2. **Event variant** — add `CommandFinished { shell_id, exit_code, duration_ms }` to
   `CoreEvent` (`events.rs`).
3. **Bridge mapping** — add the arm to `From<CoreEvent> for FresshEvent`
   (`shim-uniffi/lib.rs`) + the matching `FresshEvent` variant (regenerates
   `FresshEvent_Tags` via ubrn).
4. **JS** — nothing structural; `addFresshEventListener` already delivers it. App code
   filters on the new tag and renders.

That's the *whole* loop. Every subsequent signal (cwd, command-start, duration) repeats
steps 1-3 with a different OSC match + variant. Step 4 never changes.

### Event variants chosen for the first slice (OSC 7 + full OSC 133)

- `WorkingDirectoryChanged { shell_id, path }` — OSC 7 (`file://host/path`, path
  percent-decoded).
- `PromptStart { shell_id }` — OSC 133 ; A.
- `CommandStart { shell_id }` — OSC 133 ; C (first of B/C after a prompt, tolerant of
  dialect drift); the scanner records a start `Instant` here for duration.
- `CommandFinished { shell_id, exit_code: Option<i32>, duration_ms: Option<u64> }` —
  OSC 133 ; D ; `code?`. `exit_code` absent when the shell omits it; `duration_ms`
  measured from the matching `CommandStart`.

## Shell integration: the prerequisite, and how we deliver it

Everything above only fires if the **remote shell emits the OSC sequences**. Many modern
setups already do (starship, oh-my-zsh/powerlevel10k, fish, the VS Code/iTerm2
integration scripts). Plain `bash`/`zsh` on a stock server (e.g. a Synology NAS) does
**not**. This is inherent to *every* terminal's smart features — iTerm2, WezTerm, and
VS Code all gate cwd/exit-code/command-nav on the same thing — but we have to give users
a clear path to turn it on, plus honest UI when it's off.

### It's a shell *script*, not an install

Nothing to compile or package-install. "Shell integration" = the interactive shell
**hooks its prompt** to print the OSC sequences. For bash it's ~15 lines:

```bash
# fressh shell integration (OSC 7 cwd + OSC 133 semantic prompt)
__fressh_osc7()    { printf '\033]7;file://%s%s\033\\' "$HOSTNAME" "$PWD"; }
__fressh_preexec() { printf '\033]133;C\033\\'; }          # a command is about to run
__fressh_precmd()  {
  local ec=$?
  printf '\033]133;D;%s\033\\' "$ec"                       # last command done + exit code
  __fressh_osc7                                            # cwd (changes after cd)
  printf '\033]133;A\033\\'                                # new prompt
}
PROMPT_COMMAND="__fressh_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
trap '__fressh_preexec' DEBUG
```

zsh uses `precmd`/`preexec` functions; fish uses `fish_prompt` + a `fish_preexec` event.
We ship one snippet per shell family.

### How VS Code does it (and why we can't copy the auto-path for free)

VS Code **launches the shell itself**, so it injects the script without touching dotfiles:
zsh via a temp `$ZDOTDIR`, bash via `bash --init-file <script>` (the script sources the
user's rc first), fish via `$XDG_DATA_DIRS`. For **Remote-SSH** it first installs a
~100 MB **VS Code Server** on the host, and *that* server spawns the terminal — so it
gets the same launch control remotely. The integration itself is still just the script;
the server is what grants controlled launch.

fressh is a plain SSH client: `request_shell` runs the user's login shell with their
normal rc — we don't get to pass `--init-file`/`$ZDOTDIR`. No server, no controlled
launch. So our delivery options are:

| Option | What happens | Touches host? | Tradeoff |
| ------ | ------------ | ------------- | -------- |
| **A. Documented one-liner** | Show the snippet; user pastes it into their rc once | No (user does it) | Transparent, persists, zero risk. The honest default. |
| **B. Assisted install (opt-in)** | A per-host toggle appends the snippet to `~/.bashrc`/`~/.zshrc` over an exec channel, idempotent + marker-guarded | Yes — edits dotfiles | One tap, persists. Needs explicit consent + an uninstall (remove the marked block). Needs the `exec()` helper the git doc calls for. |
| **C. Ephemeral per-session** | Instead of `request_shell`, `exec` the shell with our rc (`bash --rcfile …`), or type a `source …` line at startup | No (nothing persisted) | No dotfile changes, but racy with user typing + can pollute scrollback/history (the `pwdprintf` glitch class). Shell-type detection required. |

**Plan:** ship **A** first (snippet + a "Set up shell integration" help screen — zero
risk, proves the feature). Add **B** as the opt-in convenience (phone users won't hand-
edit `~/.bashrc`), with a marked, removable block and a clear consent dialog. Treat **C**
as a later "no-install" power-user mode, not the default.

### Settings UI (per-host)

A "Smart terminal" / "Shell integration" section, scoped **per host** (it's a property
of the remote, not a global app pref — store alongside the host entry, not via the
global MMKV prefs factory):

- **Toggle: enable shell-integration features for this host.** Off → the scanner can
  keep running (cheap) but the app shows no semantic UI; or we suppress entirely. Default
  off until the user opts in, since it implies either pasting a snippet (A) or letting us
  edit their dotfiles (B).
- **Mode:** "I'll add it myself" (A — reveals the copy-paste snippet + per-shell tabs
  bash/zsh/fish) vs. "Set it up for me" (B — appends, shows what will be written, offers
  removal).
- **Instructions / status:** detected shell, whether the marker block is present, a
  "Test" button (sends the `$PWD` probe like the debug panel) and a live "detected ✓ /
  not detected" readout.
- **Privacy note:** integration only makes the shell *emit* cwd/exit metadata to the app
  on-device; nothing leaves the device from this layer (the AI doc's remote path is
  separate and separately gated).

### Detection + terminal-view status UI

The terminal screen needs an at-a-glance indicator of whether semantics are live, so the
feature never feels silently broken:

- **Detection signal.** We infer "integration active" from having seen **any** OSC 7 or
  OSC 133 event on this shell (track per-shell in the semantics store; add a
  `detected: boolean` / `firstSeenAtMs`). No event after the first prompt ⇒ likely not
  enabled. (Optionally a one-shot active probe on shell open — the `$PWD` printf — but
  prefer passive detection to avoid touching the user's session uninvited.)
- **Three states to render:** `off` (toggle disabled for host) · `enabled-waiting`
  (on, but no events seen yet — "waiting for shell integration… tap to set up") ·
  `active` (events flowing — show the real badge: cwd, last exit, running spinner).
- **Affordance.** A small status chip in the terminal toolbar/top bar: tap it → the
  settings section above (or the quick setup sheet). When `active`, it becomes the
  product badge (the compact cwd + exit-code pill that the current debug panel will be
  slimmed down into).

This replaces the temporary `TerminalSemanticsDebugPanel`: the debug panel proved the
seam; the shipped UI is the status chip + compact badge, plus the settings/instructions
flow.

## Why build this as its own layer

- **Reuse:** git-aware UI, error badges, command timing, "jump to last failed command",
  command history, and per-command scrollback marks are *all* downstream of these few
  events. Build the seam once.
- **Cheap increments:** after the first variant lands, each new feature is a parser arm
  + an enum variant.
- **Keeps the perf invariant:** these are low-frequency events (per command / per cd),
  so they belong on the existing `CoreEvent` plane — the high-frequency byte stream
  stays native, untouched.

## Open questions

Resolved in the first slice:
- ~~**Per-shell routing.**~~ Every `CoreEvent` carries `shell_id`; the JS store keys by it.
- ~~**Backpressure / ordering.**~~ The scanner sees `A`/`B`/`C`/`D` in stream order and
  emits synchronously from the reader loop, so the running/idle state derivation is sound.
- **OSC 133 dialect drift** (partially handled): the scanner coalesces `B`/`C` into one
  `CommandStart` and tolerates a missing exit code on `D`. Still TODO: test against the
  VS Code integration script's `133` flavor and against VS Code's own `OSC 633` (its
  private superset) — decide whether to also parse `633`.

Open:
- **Delivery default (A vs B vs C)** — confirmed plan is A first, B opt-in; still need
  the consent + uninstall UX for B and per-shell-family snippets (bash/zsh/fish).
- **Where per-host settings live.** Store the integration toggle/mode with the host
  entry, NOT the global MMKV prefs factory (it's per-remote). Confirm the host model has
  room or add it.
- **Active probe vs passive detection.** Prefer passive (saw an event ⇒ detected). Is a
  one-shot `$PWD` probe on shell open worth the scrollback noise for faster detection?
  Leaning no by default, maybe a manual "Test" button only.
- **Should the scanner run when integration is disabled for a host?** It's cheap, so
  running it always (and just hiding UI) keeps detection working to *offer* setup. Decide
  whether "disabled" means "hide UI" or "don't scan."
- **Multi-shell / nested shells.** `tmux`, `su`, `docker exec`, a remote `ssh` hop — each
  inner shell needs its own integration to emit; the outer markers won't cover it. Document
  as a known edge, not a v1 blocker.

## Relationship to git-diff-integration

That feature needs exactly two signals from this layer: **OSC 7** (cwd → which repo) and
optionally **OSC 133;D** (command finished → refresh `git status` the instant an agent
stops writing). Build this layer first (or at least the OSC 7 + `CoreEvent` variant
slice of it) and the git feature becomes mostly UI.
