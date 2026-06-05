# Future project: terminal semantic events → JS (shell integration)

**Status:** NOT STARTED — exploratory. The foundational capability that several
"smart terminal" features (git-aware UI, exit-code badges, command timing) all sit on.
See [git-diff-integration.md](git-diff-integration.md) — that feature is one *consumer*
of this pipeline.

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

## Where the semantics come from: OSC / shell-integration sequences

The signals we want are **standard escape sequences** a shell emits when configured for
shell integration (a.k.a. "semantic prompt"). They arrive in the byte stream and are
parsed by the vte parser alacritty already vendors. We catch them in **one place** —
`CoreListener` in `fressh-core/src/session.rs`, which today only reacts to
`Event::PtyWrite`:

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

vte **already parses OSC**; alacritty already routes it. The work is handling these
specific OSC cases in `CoreListener` instead of ignoring them — not writing a parser.

## End-to-end work to add (e.g.) "last command failed"

1. **Parser hook** — in `session.rs` `CoreListener`, match `OSC 133 ; D ; n` → call
   `emit(CoreEvent::CommandFinished { shell_id, exit_code: n })`.
2. **Event variant** — add `CommandFinished { shell_id, exit_code }` to `CoreEvent`
   (`events.rs`).
3. **Bridge mapping** — add the arm to `From<CoreEvent> for FresshEvent`
   (`shim-uniffi/lib.rs:193`) + the matching `FresshEvent` case / tag in the uniffi
   interface (regenerates `FresshEvent_Tags`).
4. **JS** — nothing structural; `addFresshEventListener` already delivers it. App code
   filters on the new tag and renders.

That's the *whole* loop. Every subsequent signal (cwd, command-start, duration) repeats
steps 1-3 with a different OSC + variant. Step 4 never changes.

## The catch: shell integration must be enabled

Same constraint as OSC 7 in the git doc: the remote shell only emits OSC 133 if its
prompt is configured for it. Many modern setups already do (starship, oh-my-zsh/zsh
themes, fish, the VS Code/iTerm2 shell-integration scripts). For others we'd need to:

- detect absence (no `133;D` ever seen) and degrade silently, and/or
- document / offer a one-line rc hook, and/or
- offer an opt-in that appends the integration snippet to `~/.bashrc` (invasive — needs
  consent UX).

This is inherent to *every* terminal's smart features, not a fressh limitation — iTerm2,
WezTerm, and VS Code all gate cwd/exit-code/command-nav on the same shell integration.

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

- **OSC 133 dialect drift.** Implementations vary slightly (FinalTerm vs. iTerm2 vs.
  VS Code flavors of `133`). Pick a tolerant parse; test against starship + the VS Code
  integration script.
- **Per-shell routing.** Events must carry `shell_id` so multi-shell UIs attribute them
  correctly (the enum already keys everything by id — keep that).
- **Backpressure / ordering.** `A`/`B`/`C`/`D` must be observed in order to derive
  state ("running" vs "idle"); the parser sees them in stream order, so this is fine as
  long as we emit synchronously from `CoreListener`.
- **What about shells with no integration?** Decide the default UX: invisible, or a
  gentle one-time "enable richer terminal features?" prompt.

## Relationship to git-diff-integration

That feature needs exactly two signals from this layer: **OSC 7** (cwd → which repo) and
optionally **OSC 133;D** (command finished → refresh `git status` the instant an agent
stops writing). Build this layer first (or at least the OSC 7 + `CoreEvent` variant
slice of it) and the git feature becomes mostly UI.
