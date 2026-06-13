# Why each `bun patch` exists

Running log of every entry in the root `package.json` `patchedDependencies`. Each patch is a
local fix to a dependency that we couldn't (yet) get upstream. **When you add, update, or remove
a patch, update this doc** — say what broke, why the patch is the right fix, and link the
upstream issue/PR if one exists (file one if it doesn't).

To create one: `bun patch <pkg>` → edit `node_modules/<pkg>` → `bun patch --commit 'node_modules/<pkg>'`.
Bun writes `patches/<pkg>@<version>.patch` and registers it. Patches are keyed to the exact
version — bumping the dep means re-applying (and re-validating) the patch.

## `nitrogen@0.35.9` — Nitro view props never reached the native renderer

- **Added:** `783e9ba` (2026-06-02), `fix(react-native-terminal): make Nitro view shellId prop
  reach the native renderer`.
- **Why:** the native `<Terminal shellId=…/>` rendered black because RN 0.85.3's
  `ConcreteShadowNode::getConcreteSharedProps()` returns a reference to a *temporary*
  `shared_ptr` (dangling — UB). Nitrogen's generated `adopt()` was the sole caller, so Fabric
  state wrapped freed/garbage props and `shellId` arrived empty. The patch makes the generated
  `adopt()` cast the stable `getProps()` member into a local `shared_ptr` instead, and flips
  `RawPropsParser(true)` → `RawPropsParser()` (cosmetic no-op mirroring
  [nitro #1345](https://github.com/mrousavy/nitro/pull/1345)).
- **Upstream:** no dedicated issue filed for the dangling-accessor fix (the root cause is
  arguably RN's accessor signature). Candidate to upstream to nitrogen.

## `expo-modules-jsi@56.0.8` / `expo-modules-core@56.0.15` — Swift 6.2 / Xcode 26 build breakage

- **Added:** `40e4ff6` (2026-06-09), `fix(deps): patch expo-modules-jsi/core for Xcode 26 /
  Swift 6.2; bump expo 56.0.9`.
- **Why:** Swift 6.2 rejects `weak let` ("must be a mutable variable") and mutable stored
  properties on `Sendable` classes; both packages still ship the offending source. The upstream
  fix that closed [expo/expo#46242](https://github.com/expo/expo/issues/46242)
  ([PR #46523](https://github.com/expo/expo/pull/46523)) only adds the Swift toolchain version
  to the xcframework *cache key* — building from source under Swift 6.2 still fails. Patches
  apply the upstream-recommended `nonisolated(unsafe) weak var`.
- **Upstream:** expo/expo#46242 (closed; source itself still unfixed at these versions). Re-check
  on the next Expo SDK bump — these may become unnecessary.

## `react-native-effects@0.2.0` — `transparent` prop never reaches the native Canvas

- **Added:** 2026-06-12, with the themed-background WebGPU migration
  (docs/projects/themes-refactor.md, problem 5).
- **Why:** `ShaderView` consumes its `transparent` prop for the GPU clear color
  (`clearValue [0,0,0,0]`) but never forwards it to `react-native-webgpu`'s `<Canvas>`, which
  has its own `transparent` flag controlling whether the *native surface* composites with alpha.
  Without it the surface is opaque, so an "overlay" ShaderView renders as a black rectangle over
  whatever is behind it. One-line fix: pass `transparent` through to the Canvas (patched in both
  `lib/module` and `src` builds). Our `ThemedBackground` overlays gradient blobs/scanlines on the
  theme's background color, so this is load-bearing.
- **Upstream:** no issue exists (checked 2026-06-12 — the repo has two issues, neither related).
  Should be filed/PR'd against [blazejkustra/react-native-effects](https://github.com/blazejkustra/react-native-effects);
  the fix maps 1:1 onto their `src/components/ShaderView/index.tsx`.

## `react-native-webgpu@0.5.15` — Android NDK pin + null-texture crash guard

This patch touches three files (`android/build.gradle`, `cpp/rnwgpu/api/GPUTexture.cpp`,
`cpp/rnwgpu/api/GPUCanvasContext.cpp`) for two independent reasons. The source at this version is
cloned for reference at `docs/cloned-repos-as-docs/react-native-webgpu` (pinned to commit
`4248e8a`, the v0.5.15 release).

**1. Android build requested AGP's default NDK, not the project's** (`android/build.gradle`)

- **Added:** 2026-06-12, after the themed-background WebGPU migration
  (docs/projects/themes-refactor.md) — webgpu was added/tested iOS-only and broke `turbo android`.
- **Why:** the module compiles native code via `externalNativeBuild { cmake }` but its
  `android/build.gradle` never sets `ndkVersion`. With no pin, AGP falls back to its baked-in
  default NDK (`27.0.12077973`), which our nix `android-sdk-env` does not install — the flake
  pins exactly one NDK (`27.1.12297006`, `flake.nix`). Every other native module honors the
  project NDK via `rootProject.ext.ndkVersion` (app, react-native-terminal, expo-modules-core),
  so only webgpu failed with `NDK not configured. Preferred NDK version is '27.0.12077973'`. The
  patch adds `ndkVersion rootProject.ext.ndkVersion` (guarded by `ext.has`) to webgpu's `android`
  block so it uses the same nix-provided NDK as the rest of the build.

**2. Crash in Dawn when a render loop outlives its surface** (`SurfaceRegistry.h` + the two `.cpp` files)

- **Added:** 2026-06-12, after observing a native crash on Android tab switches (tombstone:
  `SIGSEGV` in `dawn::native::ObjectBase::GetDevice` ← `TextureBase::APICreateView` ←
  `rnwgpu::GPUTexture::createView`, on the worklet render thread `mqt_v_js`).
- **Why:** `react-native-effects`' `ShaderView` runs its render loop on a background worklet
  runtime. When the canvas surface is torn down mid-frame (Android `surfaceDestroyed` →
  `SurfaceInfo::switchToOffscreen` nulls the surface on tab switch / screen unmount), the loop
  still calls `getCurrentTexture().createView()`. `SurfaceInfo::getCurrentTexture` can then return
  a null `wgpu::Texture`, which flows to `createView()` → null deref in Dawn → process-killing
  **SIGSEGV**.
- **Fix:** make `SurfaceInfo::getCurrentTexture` return a **throwaway texture** (a fresh
  offscreen `device.CreateTexture` using the existing config) instead of null when the surface is
  gone — so the render loop renders harmlessly into a discarded target. `createView` keeps a
  non-throwing backstop (returns an empty `GPUTextureView` if a null still reaches it).
  - **Why not throw:** the first attempt guarded with `throw std::runtime_error`. That converted
    the SIGSEGV into a **SIGABRT** — the exception is *uncaught* on the worklet runtime
    (`std::terminate`), so it still killed the process. Returning a valid texture is the only
    approach that neither dereferences null nor unwinds across the worklet boundary.
  - **Why native, not app-side:** an app-side attempt to keep one persistent canvas behind the
    navigator (so it never tears down) renders correctly on JS tabs but is **occluded by opaque
    native-tab scenes** (the webgpu canvas is a transparent `TextureView` that must composite
    over the per-screen background). So the theme canvas stays **per-screen**
    (`ThemedScreen` → `ThemedBackground`) and this patch is what makes the teardown safe.
- **Upstream:** no matching issue/PR (searched `wcandillon/react-native-webgpu` via `gh` on
  2026-06-12). Related-but-distinct open issues #352 ("texture views aren't cleaned up in time")
  and #351 ("resizing breaks the canvas") corroborate the lifecycle fragility. Both the NDK fix
  (`android/build.gradle`) and the teardown fix (`cpp/rnwgpu/`) should be PR'd against
  [react-native-webgpu](https://github.com/wcandillon/react-native-webgpu). Re-check / drop the
  NDK half if upstream adds an `ndkVersion` pin; keep the teardown fix until upstream stops
  handing out null surface textures.

## `metro@0.84.4` / `metro-runtime@0.84.4` — react-native-worklets Bundle Mode support

- **Added:** 2026-06-12, with the themed-background WebGPU migration (react-native-effects'
  off-thread render loop requires worklets **Bundle Mode**).
- **Why:** Bundle Mode extracts each worklet into a separate on-disk module
  (`react-native-worklets/.worklets/<id>.js`) *during* the babel transform — after Metro's file
  crawl — so Metro throws `Failed to get the SHA-1 for: ….worklets/<id>.js` on every bundle. The
  `metro` patch short-circuits SHA-1 computation for `.worklets` paths; the `metro-runtime` patch
  adds Fast Refresh propagation into the worklet runtime. These are **verbatim upstream patches
  from Software Mansion**, shipped for exactly this purpose — we did not author them.
- **Upstream:** documented at
  [Bundle Mode setup](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/setup/);
  patch files sourced from
  [software-mansion/react-native-reanimated → packages/react-native-worklets/bundleMode/patches](https://github.com/software-mansion/react-native-reanimated/tree/main/packages/react-native-worklets/bundleMode/patches)
  (`patch-package/metro/metro+0.84.4.patch`, `…/metro-runtime/metro-runtime+0.84.4.patch`).
  Expected to become unnecessary once Bundle Mode stops being preview and Metro gains the API
  upstream — re-check on worklets/metro bumps (pick the matching version from that directory).
