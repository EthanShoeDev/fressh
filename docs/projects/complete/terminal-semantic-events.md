# Project: terminal semantic events → JS (shell integration)

**Status:** ✅ COMPLETE (2026-06-08) — verified in-app by Ethan. **Automatic OSC 633
injection** is wired end-to-end: on connect, fressh launches the remote interactive shell
with VS Code's shell-integration scripts injected, so the shell emits cwd / command
lifecycle / exit code / **command text** with **zero setup, zero dotfile edits, nothing
permanent on the host**. The scanner parses OSC 7 + 133 + 633, and the **global +
per-host settings** to control it all shipped. This is the foundational pipeline several
"smart terminal" features sit on; **the product surface that consumes it now lives in
[smart-terminal-surface.md](../smart-terminal-surface.md)** (the context bar + paged
toolbar that replace the debug panel). Consumers:
[git-diff-integration.md](../future/git-diff-integration.md),
[ai-integration.md](../future/ai-integration.md),
[preset-command-buttons.md](../future/preset-command-buttons.md).

**What's built:**
- `fressh-core/src/osc.rs` — `OscScanner` (`vte::Perform`) over a second `vte::Parser`;
  parses **OSC 7 + OSC 133 + OSC 633** (633 adds `P;Cwd=`, and `E` → the new `CommandText`
  event, with value-unescaping). Unit-tested (osc633 lifecycle / cwd / escaping / B-is-idle).
- `fressh-ssh/src/shell_integration.rs` + `scripts/` — VS Code's MIT scripts vendored
  verbatim; `build_exec_command` assembles the `sh -c` bootstrap that base64-materializes
  them into a temp dir and `exec`s the right interactive shell (bash `--init-file`, zsh
  `ZDOTDIR`, fish `--init-command`, plain-login fallback). `connection.rs::open_shell` calls
  it (via `Channel::exec`) when `StartShellOptions.shell_integration` is set (default on).
  Bootstrap validated locally on bash under a real PTY (correct 633 + exit codes + login
  sourcing). Unit-tested (quote-free invariant, per-shell dispatch, nonce).
- `events.rs` / `shim-uniffi` / regenerated ubrn bindings — adds `CommandText`; `ShellOptions`
  gains optional `shellIntegration`. Events cross to JS via `addFresshEventListener`.
- `apps/mobile`: `lib/terminal-semantics.ts` (per-shell store + capped log) tracks
  `lastCommand` (633;E); `components/TerminalSemanticsDebugPanel.tsx` debug overlay (to be
  retired by the context bar).
- **Settings (shipped):** a global "Smart terminal" kill-switch (`shellIntegrationEnabled`
  pref) + a per-host toggle (on the connect form and the saved-host detail screen, stored
  in connection metadata). Effective value = global ∧ per-host, threaded into every
  shell-open path (connect / reconnect / new-shell-on-live).

**Carried forward (not part of this completed pipeline):**
- **Product surface** — the debug panel → context bar + paged toolbar migration is now
  [smart-terminal-surface.md](../smart-terminal-surface.md)'s v0.
- **Temp-dir cleanup** on disconnect — still a `TODO` in `shell_integration.rs`.
- **zsh + fish on-device validation** — bash verified in-app; zsh/fish wired per VS Code's
  mechanism but not yet exercised on a real device.
- **A/B manual fallbacks** (snippet / dotfile append) for shells we can't auto-inject —
  deferred; auto-injection (C) covers the common case.

The remainder of this doc is the original design record (kept for the decision rationale).

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

### How VS Code does it — and why the per-session path IS open to us (corrected 2026-06-08)

VS Code **launches the shell itself**, so it injects the script without touching dotfiles:
zsh via a temp `$ZDOTDIR`, bash via `bash --init-file <script>` (the script sources the
user's rc first), fish via `$XDG_DATA_DIRS`. For **Remote-SSH** it first installs a
~100 MB **VS Code Server** on the host, and *that* server spawns the terminal — so it
gets the same launch control remotely. The integration itself is still just the script;
the server is what grants *controlled launch*.

**The earlier framing here was wrong.** It claimed fressh "doesn't get to pass
`--init-file`/`$ZDOTDIR` — no controlled launch." That's only true because of **one line**:
`fressh-ssh/src/connection.rs:183` calls `ch.request_shell(true)` — a bare login shell.
But russh's `Channel` also exposes **`.exec(want_reply, command)`** (and `.set_env(...)`).
The instant we `exec` an interactive shell *we compose* instead of `request_shell`, we
have exactly the controlled launch VS Code has — **without their server**, because we own
the SSH transport directly. VS Code needs the server only because it does *not* own the
transport; we do. So the desirable property — *only the sessions fressh initiates emit
the OSC sequences, and nothing on the host is permanently changed* — is achievable.

### Delivery options (corrected)

| Option | What happens | Touches host? | Tradeoff |
| ------ | ------------ | ------------- | -------- |
| **A. Documented snippet** | Show the snippet; user pastes it into their rc once | No (user does it) | Transparent, persists, zero risk; also works outside fressh. The Phase-1 default. |
| **B. Assisted dotfile append (opt-in)** | A per-host action appends the snippet to `~/.bashrc`/`~/.zshrc` over an exec channel, idempotent + marker-guarded | **Yes — permanent** | One tap, survives, works in *all* the user's tools. The conflict risk we want to avoid by default. Needs explicit consent + uninstall (remove the marked block). |
| **C. Per-session exec injection** ⭐ | Swap `request_shell` → `exec <shell> --rcfile <inject> -i`, where the inject sources the user's real rc first, then adds the hooks | **No — ephemeral only** | The "magic" path: zero permanent change, scoped to fressh sessions. Costs login-shell parity + shell detection (below). The Phase-2 default. |

**C has two flavors:**

- **C1 — process substitution, zero files on disk:**
  `exec bash --rcfile <(printf '…; source ~/.bashrc; <hooks>') -i`. sshd runs our exec
  string through the user's login shell, which evaluates `<()` into a `/dev/fd` pipe —
  **nothing hits disk**. Requires the login shell to support `<()` (bash/zsh yes;
  dash/fish/csh no).
- **C2 — temp rcfile (VS Code's actual mechanism):** write a tiny rc to `/tmp`,
  `exec … --rcfile /tmp/.fressh-XXXX -i`, self-delete after sourcing. Robust quoting,
  works where `<()` doesn't; writes (ephemeral) to `/tmp`, never to their config.

**Env-var smuggling (`ZDOTDIR`/`BASH_ENV`) is a dead end:** stock sshd `AcceptEnv` only
allows `LC_*`, and even those need rc cooperation. The old "type a `source …` line into
the PTY after the prompt" idea is the *worst* C variant (racy with user typing, pollutes
history + scrollback) and is **dropped** now that `.exec()` is the clean mechanism.

#### The honest cost of C (what makes it Phase 2, not Phase 1)

1. **Login-shell parity.** `request_shell` runs a *login* shell (`/etc/profile`,
   `~/.profile`, `~/.bash_profile` → PATH etc.). `bash --rcfile X -i` is interactive but
   **not** login, so the inject must replay the profile chain or users silently lose env.
   This is the fiddly part VS Code spent years on.
2. **Shell detection.** We need the remote login shell *before* injecting — a quick probe
   `exec` of `echo $SHELL` (or read `/etc/passwd`), one extra round-trip — then pick the
   bash/zsh/fish form, or fall back to A if unknown.
3. **Coverage gaps** (same known edges as multi-shell, below): `tmux`/`su`/`docker exec`/
   nested `ssh` only get the *outer* shell; a server `ForceCommand`; restricted/exotic
   shells. C must degrade to A gracefully, never break the connection.
4. **Passive win first.** Many setups (fish, starship, p10k, modern zsh) already emit
   OSC 7/133. Before offering *any* setup we just watch; if events flow it's `active` with
   zero config. Setup UI only appears when nothing is seen.

#### How VS Code actually does it (studied from source)

VS Code's source is cloned at `docs/cloned-repos-as-docs/vscode/` (gitignored). The
injection logic is `src/vs/platform/terminal/node/terminalEnvironment.ts`
(`getShellIntegrationInjection`); the per-shell scripts are in
`src/vs/workbench/contrib/terminal/common/scripts/`. What we learned and how it maps to
fressh (which, unlike VS Code, has **no server on the host** to pre-place the scripts):

- **VS Code emits ONLY `OSC 633` — its private superset — never `OSC 133`/`OSC 7`.**
  Cwd rides `633;P;Cwd=<path>`; cmdline rides `633;E;<cmd>;<nonce>`; lifecycle is
  `633;A/B/C/D;<exit>`. **Decision (2026-06-08, resolved with Ethan): adopt `633` and
  reuse VS Code's scripts near-verbatim.** Because automatic injection is now THE path, we
  *control which dialect the remote emits* — so we emit `633` and **vendor VS Code's
  MIT-licensed scripts** (`shellIntegration-bash.sh`, the four `*.zsh`, `shellIntegration.fish`)
  rather than hand-writing our own. This is the big lever: their scripts already solve the
  fiddly login-parity, value-escaping, `bash-preexec` coexistence, and `PROMPT_COMMAND`
  chaining — "the part VS Code spent years on" — so we author **almost no shell code**.
  - **Scanner: parse `7` + `133` + `633` (add `633`, keep the others).** All three map to
    the *same* `CoreEvent`s, so this is one more `osc_dispatch` arm, not a new pipeline:
    `633;A`→PromptStart, `633;C`→CommandStart, `633;D;<exit>`→CommandFinished,
    `633;P;Cwd=`→WorkingDirectoryChanged, `633;E;<cmd>`→**CommandText (a NEW signal `133`
    can't give us** — the literal command line, gold for history / per-command scrollback /
    the AI feature). Keeping `7`+`133` means we still **passively detect** users who already
    run starship/p10k/oh-my-zsh (which emit `133`/`7`, not `633`) — so we don't double-inject.
  - **Cost:** `633`'s `E`/`P` values are escaped (`\\`→`\`, `\x3b`→`;`, `\xHH`→byte) — the
    scanner must reverse that for those two sub-types. Contained, and **unit-testable in pure
    Rust** — complexity moves *out* of shell scripts (hard to test on-device) and *into*
    `osc.rs` (easy to test). Net trade we want. Optional: validate the per-session `nonce`
    VS Code embeds in `E`/env entries to stop a remote program spoofing those.

- **Login-shell parity (bash) — copy their sourcing order verbatim.** `shellIntegration-bash.sh`
  is injected via `bash --init-file <script>` with a `VSCODE_SHELL_LOGIN` env flag, and
  branches (lines ~31-59):
  - non-login → source `~/.bashrc`;
  - login → source `/etc/profile`, then the **first** of `~/.bash_profile` /
    `~/.bash_login` / `~/.profile`; then re-apply any PATH prefix.
  This is the exact bash login semantics. **fressh's `request_shell` starts a *login*
  shell** (sshd prefixes argv0 with `-`), so our inject must take the **login branch** to
  preserve PATH/env. We have no server to host the script, so deliver it via **C1 process
  substitution** (`exec bash --rcfile <(…login-sourcing…; <hooks>) -i`) or **C2 temp file**.

- **zsh is the hard shell — needs a temp `ZDOTDIR` dir of 4 files, not a single rcfile.**
  VS Code sets `ZDOTDIR=<tmp>` + `USER_ZDOTDIR=<real>` and drops `.zshenv`/`.zprofile`/
  `.zshrc`/`.zlogin` that each *temporarily restore* `USER_ZDOTDIR`, source the user's
  real counterpart, then switch back (`shellIntegration-{env,profile,rc,login}.zsh`).
  **Key for SSH:** `ZDOTDIR` can't be smuggled via SSH env (AcceptEnv blocks it), but we
  can set it **on the exec command line**: `exec env ZDOTDIR=/tmp/fressh-zsh zsh -i`. So
  zsh forces **C2 (write a temp ZDOTDIR dir on the host)** — process-sub can't supply a
  directory. This is the most complex shell; reuse their 4-file dance closely.

- **fish is easy and needs no temp file:** `fish --init-command '<our hooks>'` (login adds
  `-l`). The integration can be passed inline as the init command.

- **Their guards we should mirror:** bail out (fall back to A) if the user's configured
  shell args already contain flags we can't safely compose with, or the shell is unknown —
  `getShellIntegrationInjection` returns a typed failure rather than launching a broken
  shell. Our C path must do the same: detection-fails / unsupported ⇒ silently fall back
  to A, never break the connection.

#### Delivery mechanism: one `sh -c` bootstrap that materializes VS Code's scripts

We have no server to pre-place the scripts, so the **`exec` command itself carries them.**
The clean, single-path design (decided 2026-06-08 — "automatic and clean," Rust changes OK):

- Replace `ch.request_shell(true)` (`connection.rs:183`) with `ch.exec(true, BOOTSTRAP)`
  on the same PTY channel, **gated** by `StartShellOptions.shell_integration` (derived in JS
  from the global kill-switch ∧ per-host toggle). Disabled ⇒ unchanged `request_shell`.
- **`BOOTSTRAP` = `sh -c '<posix>'`.** Wrapping in `sh -c` normalizes the interpreter:
  sshd runs the exec string through the user's *login shell*, which may be fish/csh (NOT
  POSIX) — but every shell can invoke `sh -c '…'`, so the inner script is guaranteed POSIX
  `sh`. Keep the inner script free of single-quotes (base64 payloads are `[A-Za-z0-9+/=]`,
  quote-safe) so the nested quoting stays trivial.
- The POSIX bootstrap: `mktemp -d` a self-cleaning temp dir → `base64 -d` the embedded
  VS Code scripts into it → `case "${SHELL##*/}"` →
  - **bash** → `exec bash --init-file "$d/shellIntegration-bash.sh" -i` (+ `VSCODE_SHELL_LOGIN=1`
    since SSH shells are login shells, so their script sources the `/etc/profile`→`bash_profile`
    chain).
  - **zsh** → write the four `*.zsh` into `$d`, `exec env ZDOTDIR="$d" USER_ZDOTDIR="${ZDOTDIR:-$HOME}" zsh -i`
    (`ZDOTDIR` can't ride SSH env — AcceptEnv blocks it — but it rides the exec command line).
  - **fish** → `exec fish -l -C "source $d/shellIntegration.fish"`.
  - **anything else / `mktemp` fails / `base64` missing** → `exec "${SHELL:-/bin/sh}" -l -i`
    (plain shell — **never break the connection**; feature just stays inactive).
- The embedded scripts ship in the binary via `include_str!` (existing pattern, e.g.
  `rects.rs:230`), vendored under `fressh-core` with VS Code's MIT notice. Pass the
  `VSCODE_INJECTION=1` / `VSCODE_NONCE` / `VSCODE_SHELL_LOGIN` env the scripts expect (set
  them in the bootstrap, not via SSH env).
- **Cleanup:** fressh fires `rm -rf "$d"` over a throwaway exec on shell close (keyed by the
  dir path it generated), plus a stale-sweep of `${TMPDIR:-/tmp}/.fressh.*`; the scripts also
  best-effort self-remove. Nothing permanent ever lands.

**Open naming choice:** keep the upstream `VSCODE_*` env names + script filenames for
near-verbatim vendoring (tracks upstream, less divergence per [[minimize-alacritty-fork-divergence]]),
vs. rename to `FRESSH_*` for clean `ps` output. Leaning keep-upstream initially.

**Plan:** A/B below are **demoted to manual fallbacks** (power users who want it in their
*own* non-fressh sessions, or shells we can't auto-inject). The default and the headline
feature is this **automatic injection** — zero setup, zero dotfile edits, nothing permanent.
The status chip stays as the *signal* (active / waiting / off), but for the common case it
should just be `active` on first prompt with no setup sheet ever shown.

### Terminal-screen UI: the status chip + setup sheet

> **Superseded by [smart-terminal-surface.md](../smart-terminal-surface.md) (2026-06-08).**
> The "status chip" idea below evolved, with Ethan, into a full **context bar** (a
> thin always-visible row under the app bar) plus a **paged keyboard toolbar** for
> actions — the production home that git / AI / preset-commands all render into. The
> states and detection signal described here still hold; the *placement* is now the
> context bar, not a floating chip. Read the surface doc for the current design; this
> section is kept for the detection-state rationale.

The shipped surface is **one element** on the terminal screen — a status chip in the top
bar — that both *signals* whether semantics are live and *is the entry point* to turning
them on. It replaces the temporary `TerminalSemanticsDebugPanel` (which proved the seam).

**Detection signal.** "Active" = we've seen **any** OSC 7 or OSC 133 event on this shell.
Track per-shell in the semantics store (add `detected: boolean` + `firstSeenAtMs`). No
event a few seconds after the first prompt ⇒ likely not enabled. Prefer **passive**
detection (just watch) over an active `$PWD` probe, so we never touch the user's session
uninvited — many setups (fish, starship, p10k, modern zsh) already emit, so they light up
`active` with zero setup. A manual **"Test"** button (the `$PWD` printf) stays available
for the impatient.

**The chip — four visual states:**

```
off        ⚡̸  (muted)         tap → Setup sheet
waiting    ⚡  (amber, pulsing) "waiting for shell integration…"; after ~Ns → "not detected — tap to set up"
active     ~/proj ✓            morphs into the product badge: cwd basename · last-exit pill · run-spinner
active+err ~/proj ✗127         red exit pill on non-zero
```

**Tapping the chip → a bottom sheet that branches on state:**

- **When active:** live readout (cwd, last command's exit + duration), "Disable for this
  host," link to settings. The debug panel slims down into this.
- **When not active → the Setup sheet** (the instructions surface):
  - Header *"Smart terminal for `<host>`"* + one line: *"Lets fressh see your folder,
    command status, and timing. Nothing leaves your device."*
  - **Three mode buttons** matching the delivery options:
    - **"Turn on for fressh"** *(recommended; Phase 2 = C)* — *"Set up automatically each
      time you connect. Changes nothing on your server."* Greys to "couldn't detect your
      shell" → falls through to the snippet when detection fails.
    - **"I'll add it myself"** *(A)* — reveals the copy-paste snippet with **bash / zsh /
      fish** tabs + a Copy button.
    - **"Add to my server"** *(B, opt-in)* — *"Writes ~15 lines to `~/.bashrc` so it works
      outside fressh too."* Diff preview + explicit consent + removable marked block.
  - Footer: live **"Detected ✓ / waiting…"** + the **"Test"** button.

### Settings UI (per-host)

The Setup sheet's choices are also surfaced (and persisted) in a per-host **"Smart
terminal"** settings section — scoped **per host** (a property of the remote, not a global
pref → store alongside the host entry, not via the global MMKV prefs factory):

- **Toggle: enable shell-integration features for this host** + the chosen **mode** (off /
  A / B / C). Phase 1 ships A as the only working mode; the toggle still gates whether the
  chip/badge shows.
- **Status:** detected shell, whether B's marker block is present (for uninstall), the
  "Test" button, live "detected ✓ / not detected" readout.
- **Privacy note:** integration only makes the shell *emit* cwd/exit metadata to the app
  on-device; nothing leaves the device from this layer (the AI doc's remote path is
  separate and separately gated).

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
  `CommandStart` and tolerates a missing exit code on `D`.
- ~~**Decide whether to also parse `OSC 633`.**~~ Resolved (with Ethan, 2026-06-08):
  **parse `7` + `133` + `633` (add `633`).** Since automatic injection is THE path, we
  control the dialect → we **emit `633` by vendoring VS Code's MIT scripts** (gets their
  login-parity + escaping for free, plus `633;E` command-text that `133` lacks). Keep
  `7`+`133` for passive detection of users who already run starship/p10k/etc. The scanner
  must unescape `633`'s `E`/`P` values. See the OSC-633 bullet under "How VS Code does it."

Open:
- **Delivery default — resolved to A (Phase 1) → C (Phase 2 default), B opt-in.** The
  reframe is that **C is reachable via `Channel.exec` + an injected rcfile** (not the old
  type-and-clear), so it becomes the default "magic" path. Remaining: the C login-parity +
  shell-detection work (see "honest cost of C"), B's consent + uninstall UX, and the
  per-shell-family snippets (bash/zsh/fish) shared by A/B/C.
- **Global kill-switch (decided).** Beyond the per-host toggle, there is a **single
  app-wide setting to disable shell integration entirely** (default on). When off, the
  scanner is suppressed app-wide, no chip/badge renders, and C never alters the launch —
  fressh behaves like a plain client. The per-host toggle/mode lives *under* this global
  switch (global off ⇒ per-host UI hidden). This is the privacy/escape-hatch guarantee.
- **Where per-host settings live.** Store the per-host integration toggle/mode with the
  host entry (`connectionDetailsSchema`, `secrets-manager.ts` — has room, Effect Schema),
  NOT the global MMKV prefs factory. The *global* kill-switch DOES go through the MMKV
  prefs factory (`definePref`), since it's a genuine app-wide pref.
- **Active probe vs passive detection.** Prefer passive (saw an event ⇒ detected). Is a
  one-shot `$PWD` probe on shell open worth the scrollback noise for faster detection?
  Leaning no by default, maybe a manual "Test" button only.
- **Should the scanner run when (per-host) integration is disabled?** It's cheap, so
  running it always (and just hiding UI) keeps detection working to *offer* setup — UNLESS
  the global kill-switch is off, which suppresses the scanner outright. So: global off ⇒
  don't scan; per-host off ⇒ scan but hide UI.
- **Multi-shell / nested shells.** `tmux`, `su`, `docker exec`, a remote `ssh` hop — each
  inner shell needs its own integration to emit; the outer markers won't cover it. Document
  as a known edge, not a v1 blocker.

## Relationship to git-diff-integration

That feature needs exactly two signals from this layer: **OSC 7** (cwd → which repo) and
optionally **OSC 133;D** (command finished → refresh `git status` the instant an agent
stops writing). Build this layer first (or at least the OSC 7 + `CoreEvent` variant
slice of it) and the git feature becomes mostly UI.
