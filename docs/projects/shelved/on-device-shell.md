# Shelved project: on-device (local) shell in the native terminal

**Status:** SHELVED (2026-06-07) — explored, not started. The foundational seam it
needs already exists (built for the terminal preview), but the cross-platform build is
a substantial from-scratch piece and isn't a current priority. See **Why shelved** and
**If we revive this** below before reading the older body (which is preserved as
research but whose *exec-based* approach is now superseded — see the revival decision).

**Original scope (if pursued):** `@fressh/react-native-terminal` — a new **local** byte
source alongside `fressh-ssh`, feeding the same `fressh-core` `Term`; the mobile app's
session/tab UI to offer a local shell next to SSH hosts.

**Reference:** Termux's implementation, cloned at
`docs/cloned-repos-as-docs/termux-app`. Key files cited inline below.

---

## Why shelved (2026-06-07)

- **The immediate value already shipped.** The live terminal preview
  ([../complete/preview-terminal-theme.md](../complete/preview-terminal-theme.md)) was
  the near-term win, and it built the load-bearing primitive — a `fressh-core` `Term`
  driven by a **non-SSH byte source** — as a clean, closed seam in
  `packages/react-native-terminal/rust/fressh-core/src/source.rs` (`ReadSource` /
  `WriteSink` / `ShellBackend`). A local shell is "add one more source variant," so the
  groundwork is done and reviving later is low-friction.
- **The real build is bigger than the seam.** The decision below (no `exec`, mini
  embedded shell on *both* platforms) means we'd be **writing a shell** — a REPL, line
  handling, and a builtin command set in Rust — not just wiring a PTY to an existing
  `/system/bin/sh`. That's real, from-scratch scope for a feature most users would touch
  lightly. Other work comes first.
- **App-store distribution is a hard goal, and it constrains the design.** We want this
  on the **App Store and Play Store**. That rules out the Termux model (it's frozen at
  `targetSdkVersion=28` to keep exec-from-app-storage working, which blocks modern Play
  distribution — see the body below) and, more fundamentally, iOS forbids `fork`/`exec`
  of any binary at all. Designing for both stores forces the no-exec, in-process
  approach — which is the right long-term shape but more work than a quick Android hack.

## If we revive this — the decision: in-process "mini embedded shell", no `exec`, both platforms

Run the **same in-process Rust mini-shell on iOS and Android**, with **no `fork`/`exec`
of any binary**. This is the only model that ships cleanly on both stores and gives a
consistent UX, accepting that it's a *sandboxed builtin shell*, not a full userland.

- **What it is.** A small Rust interpreter behind the existing byte-source seam — a new
  `ReadSource::Local` / `WriteSink::Local` (or a `Local` backend) in `source.rs` — that
  runs a REPL: read a line of input, parse, dispatch to a **builtin** (e.g.
  `cd/ls/cat/echo/pwd/env/mkdir/rm/mv/cp/head/tail/clear/help/…`), write output back
  into the same `Term` every SSH/preview session already uses. Scoped to the **app's
  sandbox container** (its Documents/tmp), since that's all an unprivileged app can see
  on either OS. No external programs, no package manager.
- **Why not the alternatives** (researched 2026-06-07):
  - *Termux-style fork/exec of bundled binaries* — iOS can't do it at all; on Android it
    forces `targetSdk=28` (no modern Play). Rejected.
  - *Exec Android's `/system/bin/sh` (the old body's "Option A")* — works on Android and
    is genuinely more capable (real mksh + toybox), but has **no iOS analogue**, so it
    breaks the "consistent on both stores" goal. Kept as a possible *Android-only power
    mode* layered on top later, but **not** the v1 direction.
  - *Vendor `ios_system`* (the a-Shell / LibTerm approach: each unix tool compiled as an
    in-process library with `main()`→`cmd_main()`, dispatched on a thread; BSD-licensed,
    bundles `ls/cp/curl/tar/python/lua/tex/…`) — real-ish userland, but a large C/Obj-C
    dependency that owns stdio and would fight our Rust `Term`/core; iOS-only. Too heavy
    for v1; revisit only if users want a real toolset on iOS.
  - *Emulation* (the iSH approach: a usermode x86 emulator running real Alpine Linux,
    which is why iSH has `apk`) — essentially its own product; far out of scope.
- **UI.** Its own bottom-nav tab (e.g. "Device" / "Shell"), added via one entry in
  `apps/mobile/src/lib/tab-bar-config.ts` `TAB_ROUTES` + a route folder under
  `app/(tabs)/` — both the native and JS tab bars pick it up automatically. Visible on
  both platforms (it works on both); the screen opens a terminal bound to a local
  `shellId`.
- **Honesty.** Set expectations in the UI: this is "a shell in our sandbox," not a
  rooted device shell or a real Linux box.

> Note (correction to earlier research): Termux's banner tells users to install packages
> with **`pkg`**, not `apt` directly — `pkg` is Termux's thin wrapper around `apt`/`dpkg`.
> Either way it's a real Debian-style package manager pulling `.deb`s into `$PREFIX`;
> none of that applies to our no-exec design, which has no package manager.

---

> **Everything below is the original exploration, preserved for reference.** Its
> recommended path (exec `/system/bin/sh`, Android-first) is **superseded** by the
> no-exec, both-platforms decision above. Read it for the Termux mechanics and the
> Android exec/targetSdk analysis, not as the current plan.

## Goal

Let the user run commands on the **local Android device** using our existing native
terminal viewer — not just over SSH. A "Local shell" session: same renderer, same
gestures, same keyboard toolbar, but the bytes come from a process running on the phone
instead of a remote host. Useful for poking at the device, scripting, and as a no-server
way to try the terminal.

## Why this is largely a "swap the byte source" job

Today the data plane is: **SSH bytes → `fressh-ssh` → `fressh-core` reader loop →
`Term` (vendored alacritty) → native renderer.** A `ShellSession` (`session.rs`) wraps a
durable `Term`; a reader task feeds raw bytes into the `Processor`/vte parser; a writer
sends stdin back. **None of that cares whether the bytes came from SSH.**

So a local shell is: replace `fressh-ssh`'s SSH channel with a **local PTY master fd**,
and keep the *entire* rest of the stack. The reader task reads the PTY fd instead of the
SSH channel; `send_data` writes the PTY fd instead of the channel; resize does
`TIOCSWINSZ` on the fd instead of an SSH window-change. The `Term`, renderer, gestures,
keyboard, scrollback, and (future) semantic-event work are all unchanged.

> This is the **same local-byte-source seam** that
> [preview-terminal-theme.md](preview-terminal-theme.md) wants (a `Term` driven locally
> instead of by SSH). Preview feeds a canned string; the local shell feeds a real PTY.
> Build the "Term with a non-SSH byte source" abstraction once and both ride it.

## How Termux spawns a local shell (the mechanism to mirror)

From `terminal-emulator/src/main/jni/termux.c` (`create_subprocess`) +
`TerminalSession.java`:

1. Open `/dev/ptmx` → `grantpt()` / `unlockpt()` / `ptsname_r()` to get the slave path.
2. `tcgetattr`/`tcsetattr` the master: set `IUTF8`, clear `IXON|IXOFF` (no Ctrl-S/Q flow
   control).
3. `ioctl(TIOCSWINSZ)` with rows/cols/pixels.
4. `fork()`. Child: `setsid()`, open the slave `/dev/pts/N`, `dup2` it onto fds 0/1/2,
   close the rest, unblock signals, set env, `chdir`, `execvp(shell)`.
5. Parent: keep the **master fd** — read it for output, write it for input,
   `waitpid`/`waitFor` for exit.

For us this is a small **Android-only native function** (JNI/C or Rust via `libc`/
`nix::pty::forkpty`) that returns `(master_fd, pid)`. The master fd becomes the byte
source for a `fressh-core` reader task. iOS is out of scope (no app may fork/exec
arbitrary binaries; sandbox forbids it) — Android-only feature, degrade gracefully.

## THE risk: Android won't exec() binaries from app storage (API 29+)

This is the make-or-break constraint and the reason Termux is **frozen at
`targetSdkVersion=28`** (`gradle.properties:19`). On Android 10+ (API 29+), W^X / SELinux
policy **forbids `execve()` on files in `/data/data/<pkg>/`** when you target API 29+.
Termux ships a full ~200-300MB prefix it extracts to app data and execs — so it had to
stay at API 28, which means it **can't be distributed on modern Google Play** (Play
requires recent targetSdk). That whole strategy is a non-starter for us.

### The clean way around it (recommended): no app-data exec at all

Two options that work on a **modern targetSdk** (so we stay Play-Store-shippable):

- **Option A — run Android's own system shell (zero bundling).** Android already ships an
  executable shell + utilities on the read-only `/system` partition:
  `/system/bin/sh` (mksh) plus **toybox** (`ls`, `cat`, `ps`, `grep`, `ip`, `top`, …).
  `/system` is a legitimately executable partition — no W^X problem, no bundled binaries,
  no targetSdk freeze, **near-zero footprint.** We `execve("/system/bin/sh")` from our
  app's UID/sandbox. Limitations: you're an unprivileged app UID (no root), a restricted
  `$PATH`, no package manager, toybox is a subset of coreutils. But it's a *real* local
  shell that works on current Android and ships normally. **Best starting point** — it
  proves the entire local-PTY pipeline with no binary-distribution headache.

- **Option B — ship a static binary as a native lib (modern Termux-style workaround).**
  The one app-controlled location that stays **executable** on modern Android is the
  **native library dir** (`nativeLibraryDir`). Binaries packaged as `lib*.so` under
  `jniLibs/<abi>/` are extracted there by the installer with exec permission. So a
  **static `busybox`** shipped as e.g. `libbusybox.so` *can* be exec'd on `targetSdk
  34+`. This is the technique modern "run-X-on-Android" apps use to escape the API-28
  trap. Gives a fuller, consistent userland (busybox applets) for a few-MB APK bump —
  far lighter than Termux's full prefix. More moving parts than A (ABI-specific builds,
  the `.so`-naming trick, faking `argv[0]` for applet dispatch), so do it **after** A
  works.

- **Option C — full Termux-style bundled prefix.** Rejected: 120-180MB APK, 200-300MB
  extracted, and forces `targetSdk=28` (no modern Play distribution). Massive scope for
  a feature most users would touch lightly.

**Decision:** start with **A** (system shell, proves the pipeline, ships clean), graduate
to **B** (bundled busybox `.so`) only if users want a richer userland. Never C.

## End-to-end work (Option A first)

1. **Native spawn** (Android): JNI/Rust `spawn_local_pty(shell, args, env, cwd, rows,
   cols) -> (fd, pid)` mirroring `create_subprocess` (ptmx/grantpt/unlockpt/forkpty,
   `IUTF8`, `TIOCSWINSZ`). Default `shell = "/system/bin/sh"`.
2. **Local byte source in `fressh-core`**: a `LocalShell` analogous to `fressh-ssh`'s
   `Shell` — `recv()` reads the master fd, `send_data()` writes it, `resize()` does
   `TIOCSWINSZ`, `close()` kills the pid. Reuse the **same** `ShellSession`/`Term`/reader
   wiring (`session.rs`); only the source struct differs.
3. **Registry + control plane**: register the local shell by a `shellId` just like an SSH
   shell so the renderer binds to it unchanged (`registry.rs` `shell_term`).
4. **App UI**: a "Local shell" entry (its own item, or a pseudo-host) that opens a
   terminal route pointing at a local `shellId`. Hide on iOS.
5. **Lifecycle**: kill the child + close the fd on session close; reap the pid; surface
   exit via the existing `ShellClosed` `CoreEvent`.

Steps 2-5 reuse existing machinery almost verbatim. The genuinely new code is step 1 (a
small native fork/exec+PTY) and an Android-only build wrinkle if/when we add Option B.

## Open questions

- **Environment.** What `$PATH`, `$HOME`, `$TMPDIR`, `$TERM` do we hand the child? With
  Option A, `$HOME` = our app files dir, `$PATH` includes `/system/bin` (+ our libdir if
  we add busybox). `$TERM` should match what our alacritty parser advertises.
- **What can users actually *do*?** As an unprivileged app UID, much of the filesystem is
  off-limits and there's no root. Set expectations: this is "a shell in our sandbox,"
  not a rooted device shell. Document it so it doesn't read as broken.
- **Option B build pipeline.** Static busybox per ABI (arm64/x86_64), the `lib*.so`
  naming, `android:extractNativeLibs="true"`, and applet dispatch via `argv[0]`. Confirm
  exec-from-libdir still holds on the targetSdk we ship (it currently does; re-verify per
  Android release).
- **Security / review.** We'd be exec'ing a shell on the device on the user's behalf. It
  runs as our own app UID inside our sandbox (no privilege escalation), but it's a real
  capability — worth a security pass, and worth gating behind an explicit "Local shell"
  affordance rather than auto-spawning.
- **iOS.** No fork/exec of arbitrary binaries under the iOS sandbox — feature is
  Android-only and must be invisible/disabled on iOS, not error-noisy.
- **Relationship to preview.** If we build the local-byte-source seam for the preview
  first (feed canned bytes to a `Term`), this project slots a real PTY into that same
  seam. Sequencing preview → local-shell shares the foundational abstraction.

## Why it's worth doing

The renderer, parser, durable `Term`, gestures, keyboard, and scrollback are the
expensive parts, and they're **done** — a local shell reuses all of them by swapping only
the byte source. With Option A it's a small native fork/exec away from "fressh is also a
local terminal," with no APK bloat and no targetSdk freeze. It also turns the app into
something useful with zero servers configured, and it de-risks/seeds the local-feed seam
the preview feature wants.
