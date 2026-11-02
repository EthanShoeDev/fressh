# Why each `bun patch` exists

Running log of every entry in the root `package.json` `patchedDependencies`. Each patch is a
local fix to a dependency that we couldn't (yet) get upstream. **When you add, update, or remove
a patch, update this doc** — say what broke, why the patch is the right fix, and link the
upstream issue/PR if one exists (file one if it doesn't).

To create one: `bun patch <pkg>` → edit `node_modules/<pkg>` → `bun patch --commit 'node_modules/<pkg>'`.
Bun writes `patches/<pkg>@<version>.patch` and registers it. Patches are keyed to the exact
version — bumping the dep means re-applying (and re-validating) the patch.

## `metro@0.87.1` / `metro-runtime@0.87.1` — react-native-worklets Bundle Mode support

- **Added:** 2026-06-12 (as `0.84.4`), with the themed-background WebGPU migration
  (react-native-effects' off-thread render loop requires worklets **Bundle Mode**). Moved to
  `0.87.1` with the Expo SDK 58 upgrade (2026-11-01).
- **Why:** Bundle Mode extracts each worklet into a separate on-disk module
  (`react-native-worklets/.worklets/<id>.js`) *during* the babel transform — after Metro's file
  crawl — so Metro throws `Failed to get the SHA-1 for: ….worklets/<id>.js` on every bundle. The
  `metro` patch short-circuits SHA-1 computation for `.worklets` paths; the `metro-runtime` patch
  propagates Fast Refresh updates into the worklet runtime. These are **verbatim upstream patches
  from Software Mansion**, shipped for exactly this purpose — we did not author them. (At 0.87.1
  upstream dropped the old `require.js` `getModules` hunk; worklets 0.13 no longer calls it.)
- **Version pin:** `@expo/metro` pins the metro family to exactly `0.87.1`, while RN's own
  packages ask for `^0.87.1`, which left a mixed 0.87.1/0.87.2 tree. The root `overrides` pin
  every `metro*` package to `0.87.1`, so one metro exists and these patches apply to the copy
  Expo runs. Move the overrides and these patches together on the next Expo SDK bump.
- **Upstream:** documented at
  [Bundle Mode setup](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/setup/);
  patch files from
  [software-mansion/react-native-reanimated → packages/react-native-worklets/bundleMode/patches](https://github.com/software-mansion/react-native-reanimated/tree/main/packages/react-native-worklets/bundleMode/patches)
  (`patch-package/metro/metro+0.87.1.patch`, `…/metro-runtime/metro-runtime+0.87.1.patch`; on
  `main` only — the `worklets-0.13.x` tags stop at 0.84.4).

## `react-native-webgpu@0.19.2` — Android NDK pin

- **Added:** 2026-06-12 (as part of the `0.5.15` patch), after the themed-background WebGPU
  migration (docs/projects/themes-refactor.md) — webgpu was added/tested iOS-only and broke
  `turbo android`. Rebased onto `0.19.2` with the Expo SDK 58 upgrade (2026-11-01).
- **Why:** the module compiles native code via `externalNativeBuild { cmake }` but its
  `android/build.gradle` never sets `ndkVersion`. With no pin, AGP falls back to its baked-in
  default NDK (`27.0.12077973` at AGP 8; 28.x at RN 0.88's AGP 9), which our nix
  `android-sdk-env` does not install — the flake
  pins exactly one NDK (`27.1.12297006`, `flake.nix`). Every other native module honors the
  project NDK via `rootProject.ext.ndkVersion` (app, react-native-terminal, expo-modules-core),
  so only webgpu failed with `NDK not configured. Preferred NDK version is '27.0.12077973'`. The
  patch adds `ndkVersion rootProject.ext.ndkVersion` (guarded by `ext.has`) to webgpu's `android`
  block so it uses the same nix-provided NDK as the rest of the build.
- **Upstream:** fixed by
  [wcandillon/react-native-webgpu#601](https://github.com/wcandillon/react-native-webgpu/pull/601)
  ("use the app's ndkVersion and ndkPath", merged 2026-10-31), which is after `v0.19.2`. Drop this
  patch once a release containing it ships.

## Removed patches

Kept for history; each was dropped with the Expo SDK 58 / RN 0.88 upgrade (2026-11-01).

- **`nitrogen@0.35.9`** — Nitro view props never reached the native renderer (RN's
  `ConcreteShadowNode::getConcreteSharedProps()` returns a dangling reference, and nitrogen's
  generated `adopt()` was its sole caller). Fixed upstream in nitro 0.37.0
  ([mrousavy/nitro#1502](https://github.com/mrousavy/nitro/pull/1502), "Avoid dangling View
  props reference"): nitrogen no longer generates `adopt()`; the shared
  `ViewComponentDescriptor` in react-native-nitro-modules uses `getProps()`. RN 0.88.1 still has
  the dangling accessor, but nitro 0.37.1 never calls it.
- **`expo-modules-jsi@56.0.8` / `expo-modules-core@56.0.15`** — Swift 6.2 / Xcode 26 rejected
  `weak let` and mutable stored properties on `Sendable` classes
  ([expo/expo#46242](https://github.com/expo/expo/issues/46242)). `expo-modules-jsi` 58 has no
  `weak let` left (runtime references were redesigned; its changelog fixes the Xcode 26 build in
  #51040). `expo-modules-core` 58 keeps one `private weak let appContext`
  (`ios/Core/SharedObjects/SharedObjectRegistry.swift`), which is legal from Swift 6.3
  (SE-0481), and SDK 58's minimum is Xcode 26.4 (Swift 6.3). Only a local build with Xcode ≤ 26.3
  would need it back.
- **`react-native-effects@0.2.0`** — `ShaderView` didn't forward `transparent` to the webgpu
  `<Canvas>`. Fixed in 0.3.0, and moot anyway: react-native-webgpu 0.19 removed the Canvas
  `transparent` prop (its Android TextureView is translucent by default).
- **`react-native-webgpu@0.5.15`, teardown half** — `SurfaceInfo::getCurrentTexture` could return
  a null texture when a worklet render loop outlived its surface (Android tab switch), crashing
  Dawn in `createView`. 0.19's rewritten `SurfaceRegistry.h` documents `getCurrentTexture` as
  "never returns null" and falls back to an offscreen texture when the surface is gone. **Needs
  device QA** of the Android tab-switch teardown to confirm.
