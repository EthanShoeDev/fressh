# iOS Rendering (ANGLE → Metal)

Work outline for bringing the native terminal renderer + SSH control plane to
**iOS**, which is currently a stub on the `refresh` branch (Android-first).

> Status: **rendering on iOS (simulator).** Milestone A (SSH control plane) is
> verified — the uniffi shim installs `globalThis.NativeShimUniffi` via a hand-wired
> TurboModule (`ios/ReactNativeTerminalUniffi.mm`). Milestone B (render plane,
> ANGLE→Metal) is wired and **drawing a `Term` on a `CAMetalLayer`**: `egl.rs` +
> the shim render C-ABI are now cross-platform, `ios/HybridTerminal.swift` is a real
> `CAMetalLayer` + `CADisplayLink` view, and ANGLE (`libEGL`/`libGLESv2`, Metal) is
> vendored via a **prebuilt** xcframework (`ios/fetch-angle.sh`, kivy/angle-builder).
> Both planes share one pod/`.so` (§8). The per-task notes in **Work outline** below
> are now largely **done** — treat the new **Remaining work** section as the live list.

This doc is the **task outline only**. For the *why* — engine/renderer choice, why
ANGLE→Metal over native EAGL/GLES, the single-`.so` zero-copy design, and the layer
model — see [`complete/native-rendering-refactor.md`](complete/native-rendering-refactor.md),
especially **§5** (renderer choice / ANGLE), **§8** (one package, one `.so`), **§10**
(the package layer model), and **§11** (deprecated-GLES is a low-regret bet). That
doc's *Android plan is now largely implemented*, so its status/remaining-work notes
are stale — cite it for the decisions, but treat the **working Android code** in
`packages/react-native-terminal/{rust,android,cpp}` as the live reference to mirror
(it's what each task below points back to).

---

## Decision (carried over from §5/§11)

**Strategy A + ANGLE→Metal.** Vendor ANGLE's prebuilt `libEGL`/`libGLESv2` and run
the existing GLES2 renderer over Metal. The renderer is already written against
**EGL** (`khronos-egl`, `dynamic` feature) with the context seam isolated, so ANGLE
re-supplies EGL on iOS and the render loop ports nearly 1:1 from Android — only the
native-window handle changes (`ANativeWindow*` → `CAMetalLayer*`). Native EAGL was
rejected: iOS has no EGL, so it would force rewriting the one seam the renderer made
swappable. (`wgpu` remains the §5 fallback if iOS GLES/ANGLE becomes painful.)

## Constraint that rules out a control-plane-only shortcut

Render + russh **must** stay in one compiled staticlib so SSH bytes land in the
`Term` in-process and the renderer reads that same `Term` from `fressh-core`'s
shared registry — no marshaling bytes across JSI/`.so` (§8). `fressh-core` depends
on `fressh-render` unconditionally, so an iOS build compiles the renderer regardless.
Shipping iOS with the renderer gated off (JS-render fallback à la `main`'s xterm
webview) would reintroduce exactly that marshaling — acceptable only as a temporary
stopgap, not the target.

---

## Work outline

### 1. Rust: build `shim-uniffi` as a staticlib for iOS
- Targets: `aarch64-apple-ios` (device), `aarch64-apple-ios-sim`, `x86_64-apple-ios`
  (sim); `lipo` the sim slices; package an `.xcframework` (or vendored fat `.a`).
- **De-risk first:** confirm `shim-uniffi` + `fressh-render` + `crossfont` actually
  compile for `aarch64-apple-ios*`. The render path pulls in **FreeType** for non
  macOS/Windows targets (incl. iOS), so FreeType-for-iOS is the first unknown.
- Pattern to crib: `main`'s `react-native-uniffi-russh/rust/build-ios.sh`
  (cargo per-target → `lipo` → `xcodebuild -create-xcframework`).

### 2. Vendor ANGLE
- Add prebuilt ANGLE (`libEGL.dylib` + `libGLESv2.dylib`, Metal backend) as an
  `.xcframework` (the binaries Flutter/Chromium ship). Decide source/pinning.
- `khronos-egl` `dynamic` loads `libEGL` at runtime → point it at ANGLE's, not the
  (nonexistent) system EGL.

### 3. iOS context seam in `fressh-render`
- `EglContext::create(window, …)` must accept the iOS native-window handle
  (`CAMetalLayer*`) alongside `ANativeWindow*`. Today the Android render C-ABI lives
  in `shim-uniffi/src/android.rs` (`#[cfg(target_os = "android")]`,
  `fressh_terminal_attach(ANativeWindow*, …)`). Add an iOS analog (`ios.rs`,
  `#[cfg(target_os = "ios")]`) exposing `fressh_terminal_attach(CAMetalLayer*, …)`
  + the rest of the C-ABI (`set_shell`/`set_config`/`draw`/`resize`/`send_input`/
  `destroy`).

### 4. Nitro view: `ios/HybridTerminal.swift`
- Implement `HybridTerminalSpec` (nitrogen already generates the iOS Swift
  protocol). Own a `CAMetalLayer`-backed `UIView`; on layer-ready call
  `fressh_terminal_attach`; drive a `CADisplayLink` loop → `fressh_terminal_draw`;
  forward `shellId`/`config`/resize/teardown to the C-ABI. (Mirror Android's
  `HybridTerminal.kt` + `SurfaceView`/`Choreographer`.)

### 5. Control-plane installer (iOS analog of `cpp-adapter.cpp` + `ReactNativeTerminalModule.kt`)
- `ios/*.mm` TurboModule exposing a sync `installRustCrate(runtimePtr, callInvoker)`
  that calls `NativeShimUniffi::registerModule(*runtime, callInvoker)` → installs
  `globalThis.NativeShimUniffi`. Compile `cpp/generated/shim_uniffi.cpp`.
- TS needs no change: `src/ssh.ts` already looks up
  `NativeModules.ReactNativeTerminalUniffi.installRustCrate()` cross-platform.

### 6. Podspec + autolinking
- Flesh out `ReactNativeTerminal.podspec` (currently a STUB): link the rust
  staticlib + ANGLE xcframeworks; `source_files` the generated `cpp/generated/**`,
  hand-authored `ios/**`, and the nitrogen iOS sources. Model on `main`'s
  `UniffiRussh.podspec`.
- Enable iOS in `react-native.config.js` (currently commented out).

### 7. Turbo: implement `build:ios`
- RNT's `build:ios` is currently empty (`{}`), so `turbo ios` runs `expo run:ios`
  without building the native lib. Implement it (cargo iOS targets → xcframework,
  mirroring `build:android`'s cargo-ndk → jniLibs) with `outputs` cached, so
  `turbo ios` becomes symmetric to `turbo android`. Codegen (`ubrn:generate`) is
  already cross-platform (reads the host staticlib `.a`).

### 8. Fonts
- Bundle a FreeType-rasterizable font and wire `fontPath` for iOS (Android resolves
  a bundled font today). Tied to the §1 FreeType-for-iOS question.
- **Done.** `DejaVuSansMono.ttf` ships via the podspec `resource_bundles`
  (`FresshTerminalFonts.bundle`); `HybridTerminal.swift` resolves its path.

---

## Remaining work (post-Milestone-B-wiring)

The renderer draws on the simulator; these are the open items.

### A. Build ANGLE from source instead of vendoring a prebuilt — *priority*
Today `ios/fetch-angle.sh` downloads a prebuilt xcframework from **kivy/angle-builder**
(pinned `chromium-7151_rev1`). That's a third-party binary we don't control — we want
to build ANGLE ourselves from a pinned source.

- **Is there a Rust crate?** `mozangle` (Servo's ANGLE-as-a-crate) exists, but it only
  builds the **shader translator** by default and its `egl` feature is **Windows/D3D11
  only** — no iOS/Metal. It reverse-engineers a `cc`-crate build from ANGLE's
  `moz.build` for that narrow subset; it is **not** a path to an iOS/Metal ANGLE. So
  there is no cargo-native "build ANGLE for iOS" option.
- **Build from source = ANGLE's own toolchain: depot_tools (`gclient` + `gn` + `ninja`).**
  A standalone ANGLE checkout works (no full Chromium tree; ANGLE's `DEPS` pull what
  `gclient sync` needs). The steps (cf. kivy/angle-builder's `angle.py`):
  1. `gclient sync` (depot_tools) — fetches ANGLE + third_party deps.
  2. `gn gen out/<target>` per slice, args:
     ```
     is_component_build=false  is_debug=false  angle_enable_wgpu=false
     target_os="ios"  target_cpu="arm64"  target_environment="device"     # device
     target_os="ios"  target_cpu="arm64"|"x64"  target_environment="simulator"  # sim
     ```
     Metal needs **no flag** — `angle_enable_metal = is_apple` (auto-on); see
     `gni/angle.gni`.
  3. `autoninja -C out/<target> libEGL libGLESv2`.
  4. `lipo` the sim slices + `xcodebuild -create-xcframework` → `libEGL.xcframework`,
     `libGLESv2.xcframework` (exactly the shape `fetch-angle.sh` extracts today).
- **Upstream modifications: none needed.** iOS + Metal are first-class upstream, so
  (unlike the alacritty/crossfont *forks* we carry for the renderer cut-line and the
  fontconfig-free FreeType path) ANGLE needs **no source patch** — only build config
  (gn args). If a tweak ever became necessary we'd fork+submodule like the others, but
  it isn't now. ⇒ **pin an ANGLE commit SHA** (a plain git submodule is insufficient —
  `gclient` pulls deps outside ANGLE's git tree), not a fork.
- **Cost / shape in-repo:** depot_tools (~GB) + `gclient sync` (several GB) + a
  per-arch `gn`+`ninja` build (tens of minutes). Too heavy to run on every dev build.
  Recommended shape: a `build-angle.sh` (pinned SHA, the gn args above) that produces
  the two xcframeworks, run in **CI / once**, with the output cached or committed as a
  release artifact — "build-it-ourselves, vendor-the-output." `fetch-angle.sh` then
  pulls *our* artifact, not a third party's. Interim hardening if we keep the prebuilt:
  checksum-pin the download.

### B. Runtime hardening (the renderer draws — make it robust)
- **GL context per thread.** The `CADisplayLink` loop runs on the main thread; Android's
  `egl.rs` re-`make_current`s every frame because other GL consumers (Skia) steal the
  current context. Verify the same holds on iOS (it shares the path) and on a **real
  device** (only sim-verified so far).
- **ANGLE load on device.** `egl.rs` `dlopen`s `@rpath/libEGL.framework/...` (the
  linker emits no load command — see the `ios-render-plane-wired` memory). Confirm
  `@rpath` resolves on device, not just the simulator.
- **Resize / keyboard.** Confirm `layoutSubviews` → `fressh_terminal_resize` keeps the
  grid in lockstep when the keyboard opens/closes (the Android keyboard-resize saga).

### C. Re-verify Android after the shared-module refactor
`android.rs` → `render.rs` + the `cfg(any(android, ios))` widening were not rebuilt
with `cargo ndk` in the iOS dev environment (cargo-ndk absent). The android branches
are byte-identical, but re-run `bun run build:android` + a device smoke test.

### D. Misc
- Reconsider the `is_component_build` / dynamic-framework embedding once on device
  (App Store ships dynamic frameworks fine, but re-check signing).
- The render-quality parity items below still apply once iOS is solid.

---

## De-risk order
1. **Does `shim-uniffi`+`fressh-render` compile for `aarch64-apple-ios-sim`?**
   (FreeType-for-iOS.) — gates everything.
2. **ANGLE EGL context onto a `CAMetalLayer`** from a minimal Swift harness.
3. **Simulator** behavior (Apple-Silicon GLES has been flaky; ANGLE-from-day-one is
   the hedge — §11).

## Out of scope (for now)
Render-quality parity items already tracked under `complete/` (blend limits,
selection cutoff, cursor blink) — revisit once iOS draws a frame.
