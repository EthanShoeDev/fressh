# Future project: preset commands — one-tap commands, in-shell and one-off

**Status:** NOT STARTED — exploratory. A "could we?" + "how should it look?" doc, not a
plan. Records the idea, the two surfaces it lives on, the data model, the settings UX, and
what it shares with the other smart-terminal features so we don't re-derive them.

**Scope (if pursued):** `apps/mobile` (a presets store + a new bottom-tab **"Commands"**
surface that both manages presets and runs one-offs + the in-shell toolbar page) and a
small `@fressh/react-native-terminal` addition (an out-of-band `exec(cmd) -> output` helper
— **the same one [git-diff-integration.md](git-diff-integration.md) needs**, so the two
features share it).

**Related:**
- [smart-terminal-surface.md](../smart-terminal-surface.md) — defines the paged toolbar;
  preset buttons are **page 2** of it.
- [git-diff-integration.md](git-diff-integration.md) — shares the out-of-band `exec` helper.
- The host model + the `definePref` prefs factory + `RenameDialog` are already in the app
  (we just built per-host settings + rename), so the config UI reuses proven patterns.

## The idea

A **preset** is a labeled command the user can run with one tap instead of typing it. Two
places it pays off on a phone, where typing long commands is the actual pain:

1. **In a live shell** — a one-tap button that types the command into the current PTY and
   (optionally) presses Enter. E.g. `git status`, `ls -la`, `clear`, `tail -f
   /var/log/app.log`, `docker compose up -d`.
2. **As a one-off, no persistent shell** — pick a host, run a single command, see its
   output, done. No PTY, no terminal screen, no shell to manage. E.g. "is the disk full?"
   (`df -h`), "restart the service" (`systemctl restart app`), "what's the git status of
   my repo" — the quick *operational* checks you don't want to open a full terminal for.

Both run the *same* stored preset; they differ only in *how* the command is delivered (PTY
keystrokes vs. an `exec` channel) and *where* the output goes (the live terminal vs. a
result panel).

## Surface 1 — in-shell preset buttons (paged toolbar, page 2)

Per [smart-terminal-surface.md](../smart-terminal-surface.md), the keyboard toolbar
becomes horizontally paged; **page 2 is the preset row**:

```
[git status] [ls -la] [clear] [docker ps] [ + ]      ← horizontally scrollable
```

- **Tap** → `sendBytes(command + '\r')` through the existing `KeyboardToolBarContext`
  (same path the modifier keys use). With `autoRun` off, it inserts the text *without*
  Enter so the user can edit before submitting.
- **`[+]`** → quick-add (label + command) → saved to the presets store.
- **Long-press a preset** → edit/delete sheet (mirror the `RenameDialog` pattern we
  shipped for host/session rename).
- Horizontally scrollable within the page when there are many; the page itself is one of
  the toolbar's swipe pages.

## Surface 2 — the "Commands" bottom tab (the headline surface)

A **new bottom-tab-bar item — "Commands"** (alongside Servers / Keys / Settings — added via
`lib/tab-bar-config`). This is the dedicated home for everything preset-related, and it does
**two jobs in one screen**: it's both where you *configure* your presets and where you *run
one-off commands* on a host without a persistent shell. Preset management lives **here, not
buried in Settings** — config sits right next to use.

### Job 1 — configure / manage presets

The CRUD surface for your preset commands:
- A list of saved presets: label + command (mono, truncated), with **add / edit / delete**
  (and later **reorder**, icons).
- **Editor** — label, command, `autoRun` (and later icon). Reuse the `BottomSheet` /
  dialog pattern (already shipped — the in-shell page uses the same editor today).
- It reads/writes the **same `lib/presets.ts` store** the in-shell toolbar page reads, so a
  preset added/edited here updates toolbar **page 2** instantly (and vice-versa).

### Job 2 — run a one-off command on a host (no persistent shell)

Buttons to execute a command on a saved host *without* opening a terminal — the
phone-shaped `ssh host 'some command'`:
1. Pick a **saved host** (reuses `secretsManager.connections`, the Servers list).
2. Tap a **preset** (the same presets from Job 1) or type an **ad-hoc command**.
3. **Run** → out-of-band `exec` → **result panel** (stdout/stderr + exit-code pill,
   scrollable, copyable).
4. **Save as preset**, **re-run**, or **open a full shell here** if you discover you want
   interactivity.

**Connection lifecycle (open question, below):** reuse a live connection if one exists (open
a second channel); otherwise connect → `exec` → keep-warm-briefly or disconnect. The `exec`
channel is **no-PTY** — `channel_open_session()` + `channel.exec(cmd)` instead of
`request_shell()` — **the same `fressh-ssh` helper the git doc needs**, so building it
serves both features.

> Caveat: `exec` runs a *non-interactive* command. Long-running / interactive / paging
> commands (`top`, `vim`, `tail -f`, anything needing a TTY) don't fit the one-off model —
> stream until the user cancels, or steer them to "open a shell instead." Detect-and-degrade,
> don't hang.

**Why a tab (not Settings, not the terminal):** managing presets + firing operational
one-shots is its own mode — *"what commands do I keep, and run one quickly on a box"* —
distinct from a live session. A dedicated tab keeps config next to use and avoids cluttering
either Settings or the terminal screen.

### Data model

```ts
interface Preset {
  id: string;
  label: string;          // button text, e.g. "git status"
  command: string;        // the command line, e.g. "git status -sb"
  autoRun?: boolean;      // in-shell: send Enter (default true). Off ⇒ insert only.
  icon?: string;          // optional FontAwesome6 name for the button
  // scope (later): global (all hosts) vs. a specific host id. v1 = global only.
}
```

### Storage

- **v1 — global list via the `definePref` factory** (one MMKV-backed `presets` pref
  holding a JSON array). Matches the mandate to go through `definePref` over the single
  MMKV instance; simplest, and most presets (`ls -la`, `git status`, `df -h`) are
  genuinely host-agnostic.
- **Later — per-host presets** stored in the connection **metadata** (which now supports
  arbitrary fields after the shell-integration work — `updateConnectionMetadata`). A host
  could carry its own `restart the app server` preset. Resolve as `global ++ per-host` at
  display time.

## What it shares with the rest

- **`exec(cmd) -> output` helper in `fressh-ssh`** — built once, used by both the Commands tab
  and git status. A no-PTY channel that runs one command and returns stdout/stderr/exit.
  This feature is a good reason to build it (simpler than git's porcelain parsing — just
  pass bytes through).
- **The presets store** is independent of the `ShellContext` store (presets don't need
  semantic events to *run*), but an in-shell preset *may* read `running` to disable itself
  mid-command (open question).
- **Config UX** reuses `definePref`, `RenameDialog`/`BottomSheet`, and the host list.

## Suggested phasing

- **v0 — in-shell presets (no native work). ✅ DONE.** Page 2 of the paged toolbar + the
  global `definePref`-backed store (`lib/presets.ts`) + add/edit/delete (`+` to add,
  long-press to edit, `autoRun` toggle). Pure `sendBytes`. Shipped with the surface doc's
  v1 paged toolbar.
- **v1 — the Commands tab. ✅ MOSTLY DONE.** New bottom tab with both jobs:
  - **Manager** (shipped): list + add/edit/delete over the shared store/editor.
  - **One-off runner** (shipped for live connections): the `exec` helper landed —
    `Connection::exec_command` (no-PTY `channel.exec`, collects stdout/stderr + exit code,
    256 KiB cap) → `fressh_core::run_command` → shim `CommandResult` → JS `runCommand`. The
    `RunCommandSheet` runs on a **currently-live** connection (sibling channel, shell
    untouched), with preset quick-fill chips + a result panel (exit pill, stdout/stderr).
  - *Still pending:* **connect-fresh for a one-off** (host not currently connected) — needs
    the connect-without-shell + host-key/credential flow; today the runner only lists live
    connections. And the per-run **working-dir** field (see the cwd open question).
- **v2 — per-host presets + polish.** Per-host scope via connection metadata; reorder;
  icons; "save last command as preset"; "open a shell here" from a result.

## Open questions

- ~~**cwd for one-off commands.**~~ Resolved (2026-06-08): an SSH `exec` channel starts
  in the **login/home dir** and does NOT inherit any live shell's cwd (true even when we
  reuse a live connection — exec is a sibling channel, not the shell). So: **presets stay
  `label`+`command`, no `cwd` field** (a per-preset cwd would fight the in-shell use and
  split presets into two categories). v1 runner runs in `$HOME`; the user can
  `cd /path && cmd` in the command body (works identically in-shell and one-off).
  *Fast-follow:* a per-**run** working-dir field on the runner screen (a property of the
  run, not the preset), defaulting to home — and, when the host has a live shell, offering
  that shell's known cwd from the `ShellContext` store. Same cwd-tracking story as the git
  doc.
- **Global vs per-host scope.** v1 global; is per-host worth the metadata + merge
  complexity, or do tags/folders serve better? Most presets are global.
- **Auto-run vs insert.** Default to send-with-Enter, or insert-and-let-user-confirm?
  Dangerous commands (`rm -rf`, `git reset --hard`) argue for an insert-or-confirm path —
  maybe a per-preset `autoRun` + a confirm flag, or detect destructive verbs (shared with
  the AI doc's "flag destructive verbs" concern).
- **Non-interactive limit of `exec`.** The Commands tab can't host `top`/`vim`/`tail -f`. How do
  we detect/communicate that, and offer "open a shell instead"? Stream with a cancel, cap
  output size, timeout.
- **Connection lifecycle for one-offs.** Reuse a live connection if present; otherwise
  connect-exec-disconnect vs. keep-warm. Auth prompts (key passphrase) for a "quick" run
  are friction — how do we keep one-offs actually quick?
- **Output rendering.** Plain text panel is fine for `df -h`; but command output can carry
  ANSI color / control codes. Render raw, strip ANSI, or run it through a tiny throwaway
  `Term`? v1: strip-and-mono, note the limitation.
- ~~**Where the manager lives.**~~ Resolved: the **Commands tab** hosts the manager (next
  to the runner), not Settings — config sits next to use.
- **Secrets in commands.** A preset like `mysql -p<password>` would persist a secret in
  MMKV plaintext-ish prefs. Warn, or route secret-bearing presets through the keychain like
  connections? At minimum, document that presets are not a secret store.
