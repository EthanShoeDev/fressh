# iOS Rendering (ANGLE → Metal)

Work outline for bringing the native terminal renderer + SSH control plane to
**iOS**, which is currently a stub on the `refresh` branch (Android-first).

> Status: **not started.** Android is device-verified (single staticlib: control
> plane + GLES2 render plane sharing `fressh-core`'s registry). iOS builds, installs,
> and launches, but the `react-native-terminal` native module is a stub — so the
> uniffi control plane never installs (`globalThis.NativeShimUniffi` undefined →
> `Cannot read property 'ubrn_uniffi_shim_uniffi_fn_func_*' of undefined`), and the
> Nitro `<Terminal>` view has no iOS implementation.

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
