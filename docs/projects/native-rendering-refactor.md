# Native Rendering Refactor

Planning/architecture doc for replacing the WebView-based terminal with a
native terminal emulator, and consolidating the SSH + terminal stack into a
single React Native package.

> Status: **planning / brainstorm captured.** No code written yet. This doc
> records the decisions, the reasoning behind them, and the rejected
> alternatives so we don't re-derive them every session.

---

## 1. Goal

Replace the current WebView/xterm.js render layer with a **native terminal
emulator**, for lower latency, lower CPU/battery, and no JS-thread jank during
heavy output. While we're rearchitecting, also fix the **scrollback-loss on
re-entry** problem and make the binding layer (Rust → RN) **swappable** so we
aren't locked to any one immature codegen tool.

The work replaces **both** existing packages:

- `packages/react-native-uniffi-russh` (SSH connection via russh, uniffi
  bindings)
- `packages/react-native-xtermjs-webview` (xterm.js inside an Expo WebView)

...with **one** new package (see §10).

---

## 2. Current architecture and its problems

### How it works today

- **SSH**: `react-native-uniffi-russh` — a Rust crate (russh + tokio) exposed
  to RN via `uniffi-bindgen-react-native` (ubrn). Exposes object handles
  (`SshConnection`, `SshShell`) with async methods that surface as JS Promises.
  A background `tokio::spawn` reader loop reads channel bytes into a Rust ring
  buffer and broadcasts them.
- **Render**: `react-native-xtermjs-webview` — xterm.js running inside a WebView.
  Bytes are base64'd + JSON'd over the WebView bridge; user input comes back the
  same way.
- **App glue**: `apps/mobile` holds the `SshShell` handle in a zustand store
  (`lib/ssh-store.ts`) + react-query, so the connection survives navigation.
  `shell/detail.tsx` replays the ring buffer into a fresh xterm via
  `readBuffer()` → `writeMany()`, then live-streams new bytes via `addListener`.

### Problems

1. **Scrollback dies on re-entry.** Navigate home → back into a live shell, and
   the renderer loses all scrollback; we refill by replaying raw bytes from
   memory. Root cause: **the parsed VT/grid state lives in the disposable view
   (xterm.js)**, not in a durable layer. The *connection* already survives
   (zustand pins the handle → Rust object + ring buffer stay alive); only the
   parsed grid is lost.
2. **Performance / JS bottleneck.** Bytes cross the JS bridge (base64 + JSON)
   and rendering is a WebView. Workable today, but it's the perf ceiling.
3. **uniffi-bindgen-react-native is early.** The RN bindings are immature; we've
   had to upstream fixes ourselves. Not a tool we want welded into the
   architecture.

The README already anticipates this: "probably less performant than a native
renderer... Implementing a Nitro view seems very promising."

---

## 3. The core insight: a terminal is two halves

A "terminal emulator" is really two separable subsystems:

1. **VT engine** — parse the SSH byte stream, run the escape-sequence state
   machine, maintain grid + scrollback + cursor + styles, reflow on resize.
   (This is what xterm.js does today.)
2. **Renderer** — take that grid state and draw cells (glyphs, colors, cursor)
   every frame, and map touch/keyboard back into input bytes.

**alacritty and libghostty-vt give you an excellent engine. Neither gives you a
drop-in mobile renderer.** Choosing one of them picks your *engine*; the
*renderer + native view* is the genuinely hard, mostly-novel work.

---

## 4. Engine choice

### Candidates

- **`alacritty_terminal`** — published crate on crates.io ("Library for writing
  terminal emulators"). Pure VT state machine (`Term`, `Grid`, `vte` parser,
  PTY). **No rendering.** Rust — fits our existing toolchain.
- **`libghostty-vt`** — Ghostty's explicitly C-ABI VT library
  (`include/ghostty/vt/*.h`). Further along as an *embedding* story; even ships a
  render-state API (`render.h`) with dirty-tracking designed for custom
  renderers. But: header says "incomplete, work-in-progress... will change," and
  it's **Zig**, which diverges from our Rust/`ubrn` toolchain.

### Decision: **`alacritty_terminal`** as the engine

- Rust — matches russh + our existing native build pattern.
- Published library, *designed* to be reused as an engine.
- **Precedent:** Zed's integrated terminal is built on `alacritty_terminal`
  with Zed's own GPU renderer. This "alacritty engine + bring-your-own-renderer"
  pattern is proven in production. (libghostty-vt's render API is arguably nicer,
  but the Zig toolchain + unstable API aren't worth it for us.)

---

## 5. Renderer choice

This is the dominant cost and the part with the least prior art.

### Key finding: alacritty's renderer coupling is *shallow*

The renderer (`alacritty/src/renderer/`) lives in the **binary** crate, not the
published library — so we can't depend on it; we must vendor the source (see §6).
But it's only loosely coupled to the window/context:

- `Renderer::new(context: &PossiblyCurrentContext, ...)` does **not** create a
  window/context. `display.rs` creates the glutin context and *passes it in*.
- The renderer touches that context exactly **twice**: `get_proc_address(...)`
  to load GL function pointers, and `context_api()` to check GLES vs desktop.
  Everything else is global `gl::*` calls.

So "severing display.rs" = change `Renderer::new` to take a `get_proc_address`
closure + an `is_gles` bool instead of a glutin context. A few lines. The glyph
atlas / rect / shader / draw machinery comes along untouched. **`winit` (window +
event loop) is dropped entirely; `glutin` may be reusable just for context
creation via `raw-window-handle`, or replaced with manual EGL.**

### GLES2 vs OpenGL (context)

- **OpenGL ES (GLES)** is the mobile *subset* of desktop OpenGL. GLES2 = the
  shader-based baseline that runs on virtually every phone.
- alacritty **already ships a GLES2 renderer**: `res/gles2/*.glsl`
  (`#version 100`) alongside the desktop `res/glsl3/*.glsl` (`#version 330
  core`), picked at runtime via `is_gles_context`. So the *drawing layer is
  already mobile-shaped* — the portable part "just fits."
- What is NOT portable is **context/surface creation** (not part of GL):
  - **Android**: EGL — first-class, durable.
  - **iOS**: Apple **deprecated GLES in iOS 12 (2018)** and pushes **Metal**.
    Still works today, but legacy.

### iOS: can alacritty use Metal? → via **ANGLE**

alacritty has no Metal backend. But **ANGLE** (Almost Native Graphics Layer
Engine) implements GLES *on top of Metal* — this is how WebGL runs on Apple
platforms. So alacritty's existing GLES2 renderer runs on iOS **unmodified** via
ANGLE → Metal. Bonus: ANGLE also provides **EGL on iOS** (which iOS lacks
natively), so the same EGL context-creation code works on both platforms,
pointed at a `CAMetalLayer`. Costs: bundle size (a few MB), build complexity
(prefer prebuilt xcframeworks), and it's a translation layer.

(MoltenVK is Vulkan→Metal — irrelevant, we use GL. MoltenGL is commercial — ANGLE
is the standard answer.)

### The three renderer strategies (all share `alacritty_terminal` as engine)

| Strategy | iOS approach | Reuse alacritty renderer? | Notes |
|---|---|---|---|
| **A. Vendor alacritty GLES2** | native GLES *now*, ANGLE→Metal *later* | ✅ | Most reuse; iOS deprecation seam |
| **B. `wgpu` renderer** | native Metal (Vulkan on Android) | ❌ write cell drawing | One codebase, no ANGLE, no deprecated GLES — the "sleeper" option |
| **C. Hand-written Metal + GL** | native Metal | ❌ | Most work; ghostty is the better reference here |

### Decision: **Strategy A for v1**, with **B (`wgpu`) as the strong fallback**

- v1: **vendor alacritty's GLES2 renderer**, behind a **swappable context seam**.
  Ship native GLES on Android (and iOS, deprecated-but-fine, for an
  **Android-first PoC**); drop in ANGLE for iOS when needed — and because the
  seam isolates context creation, that swap doesn't touch the renderer.
- If the iOS GLES situation becomes annoying before ship, switch to a **`wgpu`**
  renderer over `alacritty_terminal` (native Metal+Vulkan, no ANGLE, one
  codebase). This is basically a modern Strategy C and is the recommended
  fallback.

### iOS deprecated-GLES is a low-regret bet

Because both "native EAGL/GLES" and "ANGLE" present the *same GLES2 API* to the
renderer, the only difference is context bootstrap + which layer backs the view
(`CAEAGLLayer` vs `CAMetalLayer`) — both live in *our* code (the context shim +
the Nitro view), not the renderer. So shipping deprecated GLES now and swapping
to ANGLE later is a contained, swappable change. (Watch-item: GLES on the iOS
Simulator has been flaky on Apple Silicon; ANGLE-from-day-one helps there.)

### Font rasterization (a known rider)

alacritty rasterizes glyphs via **crossfont** (FreeType/CoreText). On mobile we
bundle FreeType or use a platform font backend, then upload glyph bitmaps to a
GL texture atlas. Comes along regardless of strategy A/B/C.

---

## 6. Reusing alacritty's code: submodule the fork (these aren't either/or)

Two different artifacts:

- **Engine (`alacritty_terminal`)** — published crate → **normal cargo
  dependency.** No fork.
- **Renderer (`src/renderer/`)** — in the unpublished binary crate → we **must**
  carry a small diff (it isn't consumable as-is), so the only question is *how we
  carry it and re-sync*.

**Decision: submodule our fork; path-dep into it; the fork branch is the patch.**
The earlier framing (vendor *vs* fork *vs* patch) was wrong — they compose:

- **Fork** `alacritty/alacritty` → `EthanShoeDev/alacritty`, branch `fressh`.
- **Submodule** that fork into this repo at
  `packages/react-native-terminal/rust/vendor/alacritty` (so it's tracked,
  obvious, and gives us a local checkout).
- `fressh-render` **path-deps** into the thin `alacritty_renderer` lib crate the
  fork's branch adds (path, not git-dep → the submodule SHA is the single pin; no
  double-tracking).
- The fork branch's commits **are** the repeatable patch; if we ever want a
  literal `.patch`, `git diff <upstream-tag>..fressh` regenerates it from the same
  checkout.
- **Update alacritty** = in the submodule, rebase `fressh` on a new upstream tag,
  push the fork, move the submodule pointer, commit. Cheap because the diff is small.

Why cargo `[patch]` is still *not* the mechanism: it *replaces* a dep source, it
can't apply a diff, and there's no published crate to patch against. The
"repeatable patch" we keep is the fork branch / `git diff`, not `[patch]`.

### What the fork's lib crate must expose (measured from `src/renderer/`)

The context coupling is shallow (`Renderer::new` touches the glutin context
exactly twice — `get_proc_address`, `context_api`). But the renderer also pulls a
**bounded, well-defined** subset from the binary crate, which the fork's
`alacritty_renderer` lib crate must `#[path]`-include:

### Measured cut-line (spike, against the `fressh` branch @ engine v0.26.0)

A code-level spike (not just import counting) found the clean seam is **below
`display/content.rs`**, not at `src/renderer/`:

| Source | Verdict | Why |
|---|---|---|
| `renderer/{mod,rects,shader}.rs`, `renderer/text/*` (atlas, glyph_cache, glsl3, gles2, builtin_font) | ✅ **vendor via `#[path]`** | the real GL draw machinery; deps = `crossfont`, `gl`, `alacritty_terminal`, tiny `config::font` |
| `renderer/platform.rs` + the two `glutin` touchpoints in `Renderer::new` | **drop / seam** | `mod.rs` declares `pub mod platform;` but never calls `platform::`, so the file deletes cleanly; `Renderer::new` swaps the glutin context for `(get_proc_address, is_gles)` |
| `gl` / `gl::types` | regenerate | small `build.rs` via `gl_generator` (`Api::Gl (3,3) Core` + fallbacks — same as upstream; GLES is runtime-detected) |
| `display::{SizeInfo, color::Rgb}`, `config::{debug::RendererPreference, ui_config::Delta, font::{Font,FontDescription}}` | **hand-shim (copy minimal)** | tiny value types; copying avoids dragging alacritty's config system |
| `display/content.rs` — `RenderableCell` **producer** (the `Term`→cells iterator) | ❌ **NOT vendorable; we own it** | tangled with `config::UiConfig` (whole config), `display::Display` (window), `display::hint`, `event::SearchState`, selection/regex — i.e. the winit/serde/toml world |

So the honest boundary: **vendor the GL draw code; own the `Term → RenderableCell`
mapping.** `RenderableCell` is a clean struct (`character, point, fg, bg,
bg_alpha, underline, flags, extra{zerowidth,hyperlink}`; `Point`/`Flags`/
`Hyperlink` are public `alacritty_terminal` types), and the vendored text
renderer only reads those fields — so we define `RenderableCell` ourselves and
write a slim grid iterator that resolves colors from **our own palette**. This is
more hand-written than "just include `src/renderer/`", but it's the *better* seam:
no winit/serde/toml/hints/search drag, and it's where mobile concerns live
(touch-selection rendering, custom theming).

### Consequence: configuration is ours, and RN-driven (answers "configure alacritty from the app")

Because we own the mapping, we also **own a small config struct** instead of
vendoring alacritty's TOML-file/serde/winit-keybinding config. That small struct
(palette/theme, font family + size, cursor style, scrollback limit, …) is exactly
what we expose to the RN app: it flows JS `<Terminal>` props / control plane →
shim → `fressh-core` → `fressh-render`. alacritty's own config is desktop-file
shaped and would be the wrong thing to surface to React anyway. → config becomes
part of the FFI surface (§10) and the view props; tracked as a first-class
concern, not an afterthought.

External deps that ride along with the vendored draw code: `crossfont` (glyph
rasterization — the mobile rider; **note: needs FreeType/fontconfig system libs
to build, a real cross-compile item to verify**), `gl`, `log`, `ahash`,
`bitflags`, `unicode_width`. **`winit`/`glutin` excluded.** These draw files
rarely churn → cheap rebases.

**This linking is not new territory:** `react-native-uniffi-russh` already links a
Rust staticlib into CMake (`crate-type=["cdylib","staticlib","lib"]`,
`jniLibs/<ABI>/libuniffi_russh.a`, `cpp-adapter.cpp`). The new build just feeds
*more* sources into one target.

---

## 7. Binding layer (Rust → RN): uniffi vs craby vs Nitro

### The candidates

- **uniffi (ubrn)** — Rust-first codegen. **Object/handle model**, refcounted to
  JS. **First-class async via `#[uniffi::export(async_runtime = "tokio")]`** — it
  *drives* the tokio runtime for you. Bidirectional async callbacks
  (`with_foreign`). But: RN bindings are **early/immature** (we've patched it).
- **craby** (`docs/cloned-repos-as-docs/craby`) — TS-first codegen, **pure C++
  TurboModule** via cxx, great per-call benchmarks. Nicer authoring DX. But:
  **pre-stable** (one author, tracking issue #1); **no object/instance model**
  (named singleton modules only); **no async runtime** ("Promise" = run a *sync*
  fn on a worker thread); **Signals are one-way** (now with payloads, but no
  return value).
- **Nitro** (`docs/cloned-repos-as-docs/nitro`) — the only one that does **native
  views** (`HybridView` returns a real `UIView`/Android `View`; can take other
  HybridObjects as props). Author has stated Nitro will **never** generate Rust —
  it binds C++/Swift/Kotlin. So Rust+Nitro = you own a cxx bridge.

### The async distinction that matters (uniffi vs craby)

"Exposed as a Promise" (the JS *contract*) is independent from "uses tokio for
real" (the *execution model*):

- **Contract**: JS gets a thenable. Producible from any background work,
  including a blocking fn on a thread. craby does exactly this. **No runtime
  needed.**
- **Execution model**: the impl is `async`/`await` Futures that only progress
  when an executor (tokio) polls them, and that depend on tokio's I/O reactor,
  timers, **spawned background tasks**, and async sync primitives.

**Our russh impl is the maximally tokio-dependent case** (Meaning 2): russh is
tokio-native (no blocking API), we `tokio::spawn` a *persistent* reader loop that
outlives the call (`ssh_connection.rs:268`), use `tokio::select!` +
`tokio::time` + `broadcast`/`AsyncMutex`, and capture `Handle::current()`. grep
confirms **zero** `std::net`/blocking code. uniffi *drives* this runtime for us;
craby would not — we'd self-host a `static tokio::Runtime`, `block_on` in control
methods, and `spawn` the reader loop ourselves.

### The lifecycle insight: registry beats refcounted handles (and it's
binding-agnostic)

These are **two independent axes** — don't conflate them:

- Axis 1: binding tool (uniffi vs craby).
- Axis 2: ownership/lifecycle (refcounted-to-JS vs explicit registry).

You can have **uniffi + a registry**. For durable sessions we want the
**registry to own lifetime** (a session is a long-lived background resource, like
a tmux session — not a UI object hostage to JS GC):

```rust
static REGISTRY: OnceCell<DashMap<Id, Arc<Session>>> = ...; // Session = conn + shells + Term + reader task
```

- Registry holds the `Arc` → **pins** lifetime; dropping a JS handle can't kill
  the session.
- Explicit `disconnect(id)` removes the entry → drops the pin (refcount becomes a
  safety-net for final teardown).

**Consequence the user spotted:** once a registry owns lifetime, uniffi's
*marquee* feature (refcounted handles) is unused, and the "flatten objects → ids"
cost we'd charged against craby disappears because **we're choosing the id-keyed
API anyway**. The architectural gap between uniffi and craby narrows to almost
nothing. What survives:

1. tokio runtime — uniffi drives it; craby = self-host (~15 lines in greenfield).
2. host-key callback — uniffi does bidirectional; craby Signals are one-way → but
   we can model host-key verification as **park/resume** (emit `hostKeyPending`,
   park a `oneshot` keyed by connId, resume on `respondToHostKey(id, accept)`),
   which is expressible *identically* in both tools and arguably cleaner.

After designing those away, the **only** durable differentiator is **maturity** —
and *both* tools are immature in different ways.

### Decision: **binding-agnostic core + thin swappable shim; uniffi now, craby
later**

Put all the hard, durable logic in a **pure Rust crate (`fressh-core`) with zero
binding annotations**: the tokio runtime, the registry, sessions, russh logic,
`Term`, and host-key park/resume. The binding (uniffi or craby) becomes a **thin
shim of ~6–8 id-keyed functions + an event sink** that calls into the core.

- Design the core's FFI boundary to **craby's lowest common denominator** (flat
  id-keyed fns; `Promise<T>` over sync entry points; one-way event sink;
  `ArrayBuffer`/structs/enums). A boundary craby can express, uniffi can express
  trivially.
- **Ship the uniffi shim first** (we can stand it up fast, reuse russh logic),
  **swap to craby later** when it stabilizes — replacing wrappers, not
  rearchitecting.
- This is the hedge against *both* tools being immature: neither leaks into the
  architecture.

### Nitro is for the **view only**

Nitro is the only tool that does native views, and the view is **async-free** (it
takes props + draws shared native state on a render thread; its imperative
methods are sync). So Nitro's weak async story is a non-issue, and the painful
"marshal promises across cpp" problem **never occurs** because no promise crosses
the Nitro/cxx seam — all async lives in the uniffi/craby control-plane shim.

---

## 8. Packaging & linking: one package, one `.so`

An **RN package is not a native boundary** — all native code in the app is one
process. The real boundary is the compiled `.so`/framework. JS is a bottleneck
*only if data is routed through a JS-facing API.*

Separate the two axes:

- **Modularity → Rust crates** (cargo workspace): `fressh-ssh`, `fressh-render`,
  `fressh-core` (+ external `alacritty_terminal`). Independently
  testable/publishable.
- **Native runtime + binding → ONE RN package → ONE `.so`** that statically links
  those crates.

**Why one `.so` is mandatory for native data sharing:** if ssh + render were
separate packages/`.so`s, each would link its own copy of `alacritty_terminal` +
tokio → two `Term`s, two runtimes, no shared `Arc<Mutex<Term>>` without a fragile
cross-`.so` C ABI. Linking `libfressh_core.a` **once** into **one** `.so` makes
its `static`s (the registry, the runtime) a single shared instance — so the SSH
side and the render side see the same `Term`. (Internally this mirrors how
alacritty itself runs: a reader thread writes `Term` under a lock; a render
thread reads it.)

**Cost (honest):** neither nitrogen nor the uniffi/craby codegen expects to share
a package, so we hand-author one umbrella `CMakeLists.txt` (include nitrogen's
generated cmake + add the shim's generated C++ + import the cargo staticlib → one
target), plus the analogous `build.gradle` / `.podspec`. Mechanical build glue,
not the error-prone async work.

(Two packages would only work via a *third* dynamically-linked core `cdylib` with
a stable C ABI both load at runtime — more friction, worse on iOS. Rejected.)

---

## 9. Durable terminal state (tmux-style reattach)

The scrollback fix falls out of the new architecture almost for free:

- The parsed grid is **`alacritty_terminal::Term`**, living in **`fressh-core`'s
  registry**, not the view.
- The reader loop feeds `Term` **continuously in the background**, view or no view
  (same as it feeds the ring buffer today).
- **View mount** → attach to the existing `Term` by `shellId`, draw current state
  **instantly** (full scrollback, already parsed). **Unmount** → detach; `Term`
  keeps living. **Re-enter** → instant, **no replay, no re-parse.**

This is the **tmux detach/reattach** model: session state is durable and
decoupled from whether a client is looking at it.

**Simplification:** with `Term` as the source of truth, the raw-bytes replay
machinery (`readBuffer`/`writeMany`) can be **deleted**. Keep a raw buffer only
if wanted for export/search/logging (optional, not load-bearing for display).

**Costs:**

1. **Memory** — set a **bounded scrollback** (alacritty's `Term` history limit,
   e.g. 10k lines) so durable sessions can't grow unbounded.
2. **Explicit cleanup UX** — registry pins lifetime, so sessions need a deliberate
   "close session" affordance. (We already manage explicit `disconnect` today, so
   this isn't really new — just made first-class.)

---

## 10. The new package

### Name

**`packages/react-native-terminal`** → npm **`@fressh/react-native-terminal`**
(follows the existing `react-native-<thing>` convention; "terminal" is the
headline artifact). Alternative if SSH should be explicit:
`@fressh/react-native-ssh-terminal`.

Replaces `react-native-uniffi-russh` + `react-native-xtermjs-webview`.

### Responsibilities

- Establish & manage SSH connections (was `uniffi-russh`)
- Parse the VT byte stream into durable `Term` state (new home for what xterm.js
  held)
- Render that state natively (replaces the WebView)
- Own session lifetime in a registry (tmux-style reattach + full scrollback)
- Key generation/validation
- Public RN API: connect hooks/store + a `<Terminal/>` component

### Layer model

```
@fressh/react-native-terminal  (ONE pkg, ONE .so)

 JS/TS:  useSshConnect() · sshStore · <Terminal shellId=.. />
    │ control plane (async, events)        │ render plane (native, per-frame)
    ▼                                       ▼
 binding shim                          Nitro HybridView
 (uniffi OR craby, THIN, swappable)    (owns GL surface + render thread;
    │ calls                             no uniffi/craby, no promises)
    ▼                                       │ calls C-ABI (cxx/cbindgen)
 ┌──────────────── fressh-core (PURE Rust — the agnostic boundary) ───────────┐
 │  static tokio Runtime · Registry<Id, Session> · host-key park/resume        │
 │  Session = connection + shells + Term + reader task                          │
 │  fressh-ssh (russh) ─reader loop─▶ alacritty_terminal::Term ◀─reads─ fressh-render
 └──────────────────────────────────────────────────────────────────────────────┘

 Crosses JS: connect/start/send/resize/disconnect/respondHostKey + low-freq events.
 NEVER: the byte stream, NEVER: frames.
```

### Directory structure

```
packages/react-native-terminal/
├── package.json
├── rust/                          # cargo workspace (binding-agnostic)
│   ├── fressh-ssh/                # russh wrapper (auth, channels, I/O)
│   ├── fressh-render/             # vendored alacritty GLES2 renderer over Term
│   └── fressh-core/              # OWNS runtime, registry, sessions, host-key park/resume
│       │                          #   crate-type=["staticlib"] -> libfressh_core.a
│       ├── Rust API (no annotations)   # what the shim wraps
│       └── C-ABI (cbindgen)            # what the Nitro view calls
├── bindings/
│   ├── uniffi/                    # the shim we ship FIRST
│   └── craby/                     # LCD target; swap-in later
├── nitro/                        # *.nitro.ts spec for <Terminal> HybridView
├── cpp/  android/  ios/          # native glue: shim C++ + Nitro view C++ + link libfressh_core.a
├── nitrogen/generated/ …
└── src/                          # TS public API
    ├── ssh.ts                     # useSshConnect, sshStore (control plane)
    ├── Terminal.tsx               # getHostComponent(...) wrapper for the Nitro view
    └── index.ts
```

### The agnostic FFI surface (craby-LCD shaped)

```ts
interface FresshControlSpec {
  // connection lifecycle (objects -> ids)
  connect(opts: ConnectOptions): Promise<string>;          // -> connectionId
  disconnect(connectionId: string): Promise<void>;

  // host-key verify (callback-returning-bool -> park/resume)
  respondToHostKey(connectionId: string, accept: boolean): void;

  // shells (conn.startShell()/shell.sendData() -> id-keyed)
  startShell(connectionId: string, opts: ShellOptions): Promise<string>; // -> shellId
  sendData(shellId: string, data: ArrayBuffer): Promise<void>;
  resize(shellId: string, cols: number, rows: number): void;
  closeShell(shellId: string): Promise<void>;

  // keys (craby sweet spot; sync)
  generateKeyPair(type: KeyType): Promise<string>;
  validatePrivateKey(pem: string): KeyValidation;

  // events: ONE-WAY sink (uniffi callback / craby Signal):
  //   connectProgress | hostKeyPending | connectionClosed | shellClosed
}
```

### Interface changes vs today

| Today (uniffi objects) | New (agnostic, craby-LCD) |
|---|---|
| `conn = connect()`; `conn.startShell()` (objects) | `connectionId`/`shellId` strings; `startShell(connectionId)` |
| host-key: `async on_change() -> bool` callback | `hostKeyPending` event + `respondToHostKey(id, accept)` (oneshot park/resume) |
| `ShellListener` streaming **bytes to JS** | **gone** — bytes stay native, feed `Term`, renderer reads `Term` |
| `readBuffer()`/`writeMany()` replay | **gone** — `Term` is durable; reattach instant |
| lifetime = JS handle refcount | lifetime = **registry** (explicit connect/disconnect) |

### Where each tech sits

- **Control plane** (JS → shim → core): connect/start/send/resize/disconnect/
  respondHostKey/keys. Async. Rare. → uniffi (now) / craby (later).
- **Event plane** (core → shim → JS): progress, hostKeyPending, closed. One-way.
  Rare.
- **Render plane** (Nitro view ↔ core C-ABI): attach(shellId, surface),
  render_frame, send_input, detach. Native, per-frame/per-keystroke. **Never JS.**
- **Data plane** (SSH ↔ core): bytes → reader loop → `Term`. **Pure Rust, never
  leaves the `.so`.**

---

## 11. Reference repos cloned for analysis

Under `docs/cloned-repos-as-docs/`:

- **`alacritty/`** — engine (`alacritty_terminal/`) + vendor-target renderer
  (`alacritty/src/renderer/`, GLES2 shaders in `res/gles2/`).
- **`ghostty/`** — libghostty-vt (`include/ghostty/vt/*.h`) as an engine
  alternative + a native **Metal** renderer reference (if we go Strategy C).
- **`craby/`** — TS-first Rust→RN codegen (candidate control-plane shim).
- **`nitro/`** — Hybrid views (`packages/react-native-nitro-test` has
  `TestView`/`RecyclableTestView`); `packages/template`, `nitrogen`.
- **`react-native-skia/`**, **`react-native-wgpu/`**,
  **`expo-gl-monorepo/packages/expo-gl/`** — three references for binding a GPU
  context/surface into an RN view + surface-lifecycle/context-loss handling.
  (Skia = canvas; wgpu = Strategy B reference; expo-gl = raw GLES-in-RN-view.)

---

## 12. Decisions log

1. **Native renderer**, replacing the WebView. (perf, durable scrollback)
2. **Engine = `alacritty_terminal`** (Rust, published, Zed precedent). Not
   libghostty-vt (Zig + unstable API).
3. **Renderer = vendor alacritty's GLES2 (Strategy A)** for v1, **Android-first
   PoC**, behind a swappable context seam; **`wgpu` (Strategy B)** as the strong
   fallback. iOS: deprecated GLES now → **ANGLE→Metal** later (contained swap).
4. **Submodule our fork** of alacritty at `rust/vendor/alacritty` (branch
   `fressh`); `fressh-render` path-deps into the fork's thin `alacritty_renderer`
   lib crate (the fork branch = the repeatable patch). Engine stays a normal
   cargo dep. (Supersedes the earlier "vendor, don't fork" call — they compose;
   renderer→binary-crate coupling measured and bounded, see §6.)
5. **Binding-agnostic `fressh-core`** (pure Rust: runtime + registry + sessions +
   Term + host-key park/resume). Thin swappable shim. **uniffi now, craby
   later.** Boundary designed to **craby's LCD**.
6. **Nitro = the view only** (async-free; no promises cross the cpp seam).
7. **Registry owns session lifetime** (durable `Term`, tmux-style reattach);
   refcount is a backstop. Delete the raw-replay machinery; bound scrollback; add
   a close-session UX.
8. **One package, one `.so`**; modularize in Rust crates. Hand-author the umbrella
   CMake/gradle/podspec.
9. **New package: `@fressh/react-native-terminal`**, replacing both old packages.

---

## 13. Open questions / next steps

### Done (proven)

- [x] **Renderer extraction compiles (host).** `alacritty_renderer` lib crate on
      the fork's `fressh` branch (submodule at `rust/vendor/alacritty`) builds
      clean via the dev shell (FreeType/fontconfig added to `flake.nix`). The
      `Renderer::new` seam + shims work; no winit/glutin/serde. Pushed to the fork
      (commit on `fressh`). `fressh-render` consumes it via path-dep and a
      `_engine_unification_check` fn proves the single `alacritty_terminal`
      instance (engine `Point` → renderer `RenderableCell`). This de-risks the
      core renderer-reuse bet.

### Done (proven) — cont.

- [x] **Renderer cross-compiles AND links for Android.** FreeType builds bundled
      under `cargo-ndk` (`libfreetype2.a`). The wall was **fontconfig**: crossfont
      routes *both* Android and iOS (only `target_os="macos"` → CoreText) through
      its FreeType+fontconfig backend, and fontconfig isn't on mobile. **Option A
      chosen + implemented**: forked crossfont (submodule `rust/vendor/crossfont`,
      branch `fressh`) with a **Fontconfig-free FreeType path** — backend chosen by
      target via `build.rs` (`crossfont_fontconfig` cfg = desktop-unix only),
      `yeslogic-fontconfig-sys` target-gated out of android/ios, fontconfig code
      gated, new `src/ft/direct.rs` loads a font by **direct file path** (the
      embedder supplies a bundled monospace font) with default render settings, no
      fallback; rasterization core shared. Consumed via `[patch.crates-io]
      crossfont` in our workspace. **Verified:** `libfressh_render.so` links for
      `aarch64-linux-android` with `NEEDED` = only `libdl/libc` (no fontconfig;
      FreeType static). Desktop-unix keeps the fontconfig path unchanged.

      "Proper way" confirmed by research: on mobile you don't use fontconfig
      (discovery); you bundle/point at a font and rasterize directly. So the
      RN-driven config (§6) must carry a **bundled monospace font path**.

### Done (proven) — cont.²
- [x] **`Term → RenderableCell` iterator + RN config/palette** (`fressh-render/src/
      {config,content}.rs`): `TerminalConfig` + `Palette` (256+13 list, OSC
      overrides) + our own `renderable_cells()` (colors/dim/bold→bright, INVERSE,
      block cursor, zerowidth/hyperlink; no selection/search/hints yet). A
      `bytes_to_cells` test proves the GL-free data path (bytes → ANSI `Processor`
      → `Term` → cells, correct chars + colors) — runs green.
- [x] **Render driver** (`fressh-render/src/driver.rs`): `TerminalRenderer` builds
      the GL `Renderer` + `GlyphCache` (bundled font via `Font::from_path`) behind
      the context seam; `resize() → (cols,rows)` + `draw(term)`. Compiles host +
      `aarch64-linux-android`.

### Next (device-bound — not runnable in the CI sandbox)
- [ ] **EGL bring-up + first pixels**: `ANativeWindow → EGL` + render thread, feed
      `get_proc_address`/`is_gles` into `TerminalRenderer::new`, draw a **hardcoded
      `Term`** at 60fps. Then the Nitro view (Kotlin `Surface` + C-ABI) + bundle a
      monospace `.ttf` asset.
- [ ] Confirm crossfont (or a FreeType bundle) builds for Android/iOS.
- [ ] Decide Nitro view vs hand-written Fabric view (compare `TestView` wiring
      boilerplate vs a raw Fabric view).
- [ ] Spike the umbrella `CMakeLists.txt` (Rust staticlib import + nitrogen
      include + shim sources → one target).
- [ ] Decide whether `wgpu` (Strategy B) should actually be v1 to skip the iOS
      GLES/ANGLE question entirely.
- [ ] Scrollback bound + close-session UX design in `apps/mobile`.
- [ ] Final package name (`react-native-terminal` vs `react-native-ssh-terminal`).
