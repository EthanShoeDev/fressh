# Debugging the WebGPU themed background on Android

Status as of 2026-06-12. This documents the **uncommitted working-tree changes**
on top of `505a72b`, why each exists, and the one design problem still open.

## Background: how we got here

Two recent shifts set the stage:

1. **Skia → WebGPU for the themed background.** The themed "chrome" (soft radial
   gradient blobs + optional CRT scanlines, per theme) used to be drawn with
   React Native Skia. We migrated it to a WGSL fragment shader driven by
   `react-native-effects`' `ShaderView`, which is backed by `react-native-webgpu`
   (Dawn). The win: ShaderView runs its render loop on a **background worklet
   runtime**, so Aurora's continuous blob drift no longer competes with the
   JS/main thread during tab switches, and static themes render one frame then
   stop (`isStatic`). The single touch-point is `ThemedBackground.tsx`.

2. **Background rendered behind the floating JS tab bar** (commit `28455a6`,
   "float JS tab bar over canvas themes"). The JS/custom bottom tab bar used to
   sit in flow *below* the scene, so the gradient stopped at the bar's top edge
   and left a flat near-black strip behind the floating pill. That commit made
   the bar **overlay** the scene (absolute) for canvas themes (aurora / phosphor
   / graphite, gated by the new `skinHasCanvas()`), so the shader runs the full
   window height under the glass pill. `useJsTabBarOverlay()` became the single
   source of truth and `useBottomTabSpacing` became mode-aware.

The migration was developed and tested on **iOS**. Bringing it up on **Android**
is what surfaced everything below.

## The working-tree diff, change by change

`git status` (on top of `505a72b`):

```
 M apps/mobile/metro.config.js
 M apps/mobile/src/components/themed/ThemedScreen.tsx
 M bun.lock
 M docs/bun-patches.md
 M package.json
 A patches/react-native-webgpu@0.5.15.patch
```

### 1. `patches/react-native-webgpu@0.5.15.patch` (new) + `package.json` + `bun.lock`

A `bun patch` against `react-native-webgpu`, registered in
`package.json`'s `patchedDependencies` (the `bun.lock` change is just that
registration). It bundles **three edits for two unrelated reasons**. Full
rationale lives in `docs/bun-patches.md`; summary:

**a. `android/build.gradle` — pin the NDK.** The module compiles native code via
CMake but never sets `ndkVersion`, so AGP fell back to its **baked-in default
NDK** (`27.0.12077973`), which our nix `android-sdk-env` does not install (the
flake pins exactly one NDK, `27.1.12297006`). Every other native module honors
`rootProject.ext.ndkVersion`; only webgpu didn't, so `turbo android` failed with
`NDK not configured. Preferred NDK version is '27.0.12077973'`. The patch adds
`ndkVersion rootProject.ext.ndkVersion` (guarded by `ext.has`) to webgpu's
`android {}` block. **Why pin webgpu to the project, not the project to webgpu:**
the project NDK is the Expo-canonical one shared by every other module; bending
the whole build to webgpu's accidental default would be backwards.

**b. `cpp/rnwgpu/SurfaceRegistry.h` — `getCurrentTexture()` returns a throwaway
texture instead of null.** This is the core crash fix (see "the crash" below).
When the surface is torn down mid-frame, the original returned a **null**
`wgpu::Texture`. The patch instead creates a fresh offscreen texture from the
existing config and hands that back, so the still-running render loop draws into
a discarded target rather than feeding null into Dawn.

**c. `cpp/rnwgpu/api/GPUTexture.cpp` — `createView()` null backstop.** A
defense-in-depth guard: if a null texture *still* reaches `createView`, return an
empty `GPUTextureView` instead of dereferencing it. Crucially it returns rather
than **throws** — throwing was the first attempt and it was worse (see below).

#### The crash this fixes

On Android, switching tabs (or unmounting a screen) fires `surfaceDestroyed()`,
which nulls the canvas surface (`SurfaceInfo::switchToOffscreen`). But the
ShaderView render loop lives on a **worklet thread** (`mqt_v_js`) and fires one
more frame, calling `getCurrentTexture().createView()`. The tombstone:

```
signal 11 (SIGSEGV), fault addr 0x10
  #00 dawn::native::ObjectBase::GetDevice()
  #01 dawn::native::TextureBase::APICreateView(...)
  #02 wgpu::Texture::CreateView(...)
  #03 rnwgpu::GPUTexture::createView(...)
  #10+ libworklets.so  (the off-thread render loop)
```

`getCurrentTexture()` returned a null surface texture → `createView()`
dereferenced null in Dawn → **process-killing SIGSEGV**.

- **Why not throw from `createView`:** the first attempt guarded with
  `throw std::runtime_error`. On the worklet runtime the exception is **uncaught**
  → `std::terminate` → the SIGSEGV simply became a **SIGABRT**. Still dead.
- **Why a throwaway texture works:** returning a valid (if discarded) texture
  neither dereferences null nor unwinds across the worklet boundary. The teardown
  frame renders into nothing and the loop survives. Steady-state rendering on a
  live, focused surface never reaches this path.

The crash timeline confirmed the fix held: native crashes stop after the rebuild;
a later rapid-tab-switch session produced **no tombstone at all**.

### 2. `apps/mobile/metro.config.js` — relocate Metro's caches into the repo

Independent of the graphics work; uncovered while iterating on the native build.
Metro keeps two on-disk caches (transform cache + file-map/haste cache) and both
default to `os.tmpdir()/…`. Under our **nix-shell**, `os.tmpdir()` resolves to
`/tmp/nix-shell.XXXX/…` — **outside the repo**. So `git clean -fxd` (which wipes
`node_modules`, including worklets Bundle Mode's generated
`react-native-worklets/.worklets/<id>.js` files) left the transform cache behind.
The stale cache still referenced those now-deleted worklet files →
`ENOENT … .worklets/<id>.js` on the next bundle.

The change points both caches at `node_modules/.cache/metro/{transform,file-map}`:

- `node_modules/.cache` is git-ignored and **is** removed by `git clean -fxd`, so
  the cache now shares a lifecycle with the rest of `node_modules` — a clean is
  genuinely clean, no stale-worklet ENOENT.
- It reuses **Expo's own binary `FileStore`** (`@expo/metro-config/file-store`)
  so we keep Expo's faster msgpackr serialization rather than metro's JSON store.
- It **pre-creates both dirs** with `fs.mkdirSync(..., { recursive: true })`,
  because `@expo/metro-file-map`'s `DiskCacheManager` writes the cache file
  *without* creating its parent (it always assumed the pre-existing `os.tmpdir()`),
  so a fresh repo would ENOENT on the first cache write.

> Operational note learned the hard way: **never wipe `.worklets` or the Metro
> cache while a Metro dev server is running.** Deleting disk files doesn't clear
> Metro's *in-memory* transform cache, so a reload reuses stale imports → the same
> ENOENT. Stop Metro, then clean.

### 3. `apps/mobile/src/components/themed/ThemedScreen.tsx` — comment only

Currently a **doc-comment-only** change: it records *why* the gradient is rendered
**per screen** rather than as one shared surface — a single canvas hosted behind
the navigator is occluded by opaque native-tab scenes (see the open problem), and
the teardown crash that per-screen rendering risks is handled by the webgpu patch
above. No behavioral change in the working tree.

> A focus-gating experiment briefly lived here (`useIsFocused()` to mount the
> canvas only on the focused screen). It stopped the multi-loop spinning but
> **caused a visible black→fade reload on every tab switch** (explicit
> unmount/remount), so it was reverted. That regression is precisely the symptom
> that motivates the open problem below.

### 4. `docs/bun-patches.md`

Documents the new webgpu patch (NDK pin + teardown crash), per the repo rule that
every `patchedDependencies` entry is explained there.

## The challenge we're approaching

We want the themed shader background to **persist smoothly across tab switches** —
never reloading, flickering, going black, or crashing — behind the bottom tab bar.

The crash is fixed, but a UX problem remains, and it's **architectural, not a
bug**:

- The canvas is **per-screen**. Each tab owns its own WebGPU surface
  (`ThemedScreen` → `ThemedBackground`).
- The bottom tab navigator **tears down a tab's GPU surface when that tab is
  hidden** (observed as a flood of `BufferQueue has been abandoned` from the
  webgpu producer). So on the way back the surface is **rebuilt from scratch** —
  black, then a frame arrives ~1s later. Rapid switching can also leave a hidden
  tab's loop spinning on an abandoned surface, and the visible canvas stuck on the
  patch's discarded fallback texture (solid black until re-init).

The only way to make it truly seamless is **one canvas hoisted above the tab
navigator that never unmounts**. And there the two tab bars diverge:

- **JS / custom tab bar** (`JsTabsLayout`): scenes are already transparent
  (`sceneStyle: { backgroundColor: 'transparent' }`) and the layout paints the app
  background behind the whole navigator. A single persistent `ThemedBackground`
  placed there **shows through every tab and never tears down → seamless.** This
  is also the direction commit `28455a6` already leaned into (overlaying the JS
  bar over the canvas).
- **Native tab bar** (`NativeTabsLayout`, `expo-router/unstable-native-tabs`):
  native scenes are **opaque** and draw on top, so a canvas hosted behind them is
  **occluded** (renders solid black). Per-screen is the only option there — which
  is the flicker. An earlier attempt to force the native scenes transparent
  (`contentStyle`) did not get the canvas to show through.

So, with what's available today, **a seamless persistent background and the native
tab bar are mutually exclusive.**

## Desired outcome

A themed shader background that:

- renders the full window height behind the bottom tab bar (already true for the
  JS overlay bar on canvas themes),
- **stays alive across tab switches** — no reload, no black flash, no spinning
  loop, no crash,
- degrades gracefully to the flat theme background color where WebGPU is
  unavailable.

The open decision is which path to take to get the "stays alive" property:

1. **JS tab bar + one persistent canvas** — hoist a single `ThemedBackground`
   into `JsTabsLayout` above `<Tabs>`; remove per-screen rendering for canvas
   themes. Seamless, all-JS, lowest risk. Cost: gives up the native
   Material/liquid-glass bar on canvas themes (the Native theme keeps native tabs;
   it has no canvas anyway).
2. **Native tab bar + accept per-screen flicker** — keep things as they are; the
   surface re-inits on each switch. No crash, but not seamless.
3. **Native tab bar + persistent canvas via native work** — make native tab
   scenes transparent (react-native-screens config/patch) or stop inactive-scene
   surface teardown, so one persistent canvas shows through behind the native bar.
   Best of both, but native spelunking that already failed once — uncertain,
   higher effort.

Given the default tab bar is already `js` and commit `28455a6` already overlays
the JS bar over canvas themes, **option 1 is the natural target** for canvas
themes, with the Native theme staying on native tabs.

## Update (2026-06-12, later): option 1 implemented + follow-ups

**Option 1 shipped and verified on the Android emulator (aurora + JS bar:
seamless).** The pieces:

- `JsTabsLayout` hosts ONE persistent `ThemedBackground` above `<Tabs>` and
  provides `CanvasHoistedContext` (exported from `ThemedBackground.tsx`).
- `ThemedScreen` consumes it: hoisted → no per-screen canvas, fully transparent
  wrapper (the layout owns the background color).
- `useThemedHeader` sets `contentStyle: transparent` on the per-tab native
  stacks when hoisted — native-stack otherwise paints the opaque
  navigation-theme background over the canvas (default in
  `NativeStackView.native.js`: `backgroundColor: colors.background`).

**Native tabs + canvas themes (the remaining per-screen path):** user testing
confirmed the doc's prediction — black flicker per switch, and *sometimes stuck
solid black* (loop spinning on the patch's discarded fallback texture, never
re-attaching). Two fixes, in order of discovery:

1. `ThemedScreen` mounts the per-screen canvas only while `useIsFocused()` —
   blur unmounts the ShaderView (stops the loop cleanly), focus mounts a fresh
   surface. (Now only relevant to screens outside the tab navigators, e.g.
   modals — see 2.)
2. **A hoisted canvas behind native tabs was attempted and REVERTED — the
   original "mutually exclusive" conclusion stands.** The reasoning that it
   *should* work: the Android scene swap is `remove(current)+add(next)` in one
   synchronous transaction (`gamma/tabs/container/TabsContainer.kt`), and no
   native layer (TabsHost, container, contentView FrameLayout, the gamma
   `TabsScreen` ViewGroup) sets an opaque background — the only background
   drawable is `container.background`, gated on `nativeContainerBackgroundColor`
   which expo-router never sets. So with the React layers made transparent
   (per-trigger `contentStyle: transparent`, plus `CanvasHoistedContext` →
   transparent stacks + `ThemedScreen`) the hoisted `ThemedBackground` *should*
   have shown through. **It did not — device showed a solid `--color-background`,
   no gradient.** The webgpu canvas is a transparent `TextureView`
   (`WebGPUTextureView.setOpaque(false)`; the `transparent` path selects
   TextureView over SurfaceView), and it composites correctly behind the all-RN
   JS-tab tree — but behind the *native fragment* hierarchy of NativeTabs it is
   occluded at the Android compositing level regardless of view transparency.
   This is the real mechanism the original doc intuited. Reverted; native tabs
   keep the per-screen focus-gated canvas (gradient shows, re-init fade per
   switch). **A seamless canvas + native bar would need a non-WebGPU renderer
   living in the RN view tree** (see "was wgpu the right call" below).

**Crash triage (user-reported, 2026-06-12 evening):** no new native tombstones —
the crash was Metro serving 500s (`TransformError: ENOENT
…/.worklets/<id>.js`, the stale-cache issue above) which kills a dev build with
`DebugServerException`. Dev-only; restart Metro. The older tombstones
(17:21–17:37) are SIGABRTs from an uncaught `fbjni::JniException` on the
worklets thread — the render loop calling into Java after its tab died; the
focus-gating above removes that loop-outlives-tab window.

**JS-tabs switch lag (all themes):** `expo-router/js-tabs` defaults
`detachInactiveScreens` to true on Android, so every switch detached/re-attached
the hidden tab's fragment tree (this same detach is what abandoned the WebGPU
buffers). `JsTabsLayout` now passes `detachInactiveScreens={false}` — hidden
scenes stay attached as `display:none`, a switch is a visibility flip. Note
`freezeOnBlur` is NOT usable here: with `enabled={false}` react-native-screens
renders plain Views and bypasses `DelayedFreeze` entirely (verified in
`react-native-screens/src/components/Screen.tsx`).

## Was WebGPU the right call? (2026-06-12 retrospective)

For the actual product requirement — *a slow animated radial gradient behind
native bottom tabs* — WebGPU is more machine than the job needs, and its core
weakness (a GPU surface with its own lifecycle / native compositing) is exactly
what fights the native tab bar:

- **JS tabs:** works great. One RN view tree, the TextureView composites behind
  transparent RN scenes, off-thread render loop, `isStatic` for the static
  themes. This is a genuinely good outcome.
- **Native tabs:** the canvas can't sit behind fragment-hosted native scenes
  (above), and a per-screen canvas is torn down on every switch (fade). Neither
  is seamless.

The boring alternative — animated radial gradients drawn as ordinary RN views
(e.g. `expo-linear-gradient`/SVG radial layers, drift via Reanimated transforms
on the UI thread) — would compose with *both* tab bars trivially, because it's
just RN views: no swapchain, no surface teardown, no fragment-compositing fight,
no Dawn patch. It loses nothing visible for a soft gradient (the shader's
premium is sharp procedural detail we don't use). The GPU-eval doc's own first
recommendation was "(a) the cheap static/RN fix first — probably the whole fix,"
gated on profiling that was skipped.

**Recommendation if native-bar + animated gradient must be seamless:** swap the
renderer behind the existing single-file `ThemedBackground` seam for an RN-view
implementation. WebGPU stays justified only if we commit to JS tabs for canvas
themes (where it shines) and accept the per-screen fade on native tabs.

### Implemented: RN-view renderer alongside WebGPU (2026-06-12)

Both renderers now live in the tree, selected by `THEMED_BACKGROUND_RENDERER`
in `ThemedBackground.tsx` (default `'views'`):

- `ThemedBackground.views.tsx` — each blob is a `View` with a native
  `radial-gradient` (`experimental_backgroundImage`, RN 0.85+); aurora drift is
  a Reanimated transform (UI thread). Scanlines are a tiled linear-gradient
  (`experimental_backgroundSize`/`Repeat`). No new dependency.
- `ThemedBackground.tsx` — the original `ShaderView`/WebGPU renderer, kept as
  `WgpuThemedBackground`/`WgpuScanlines`.

The RN-view background composites behind the **JS** tab bar (hoisted, seamless)
and has no surface teardown. **Native tabs remain a per-screen, flickering
path** — and this is now a hard, twice-verified conclusion:

- Hoisting one persistent background behind the native tab host was attempted
  with BOTH the WebGPU `TextureView` and a plain RN view. **Both showed a solid
  `--color-background` with no gradient** — i.e., anything placed behind the
  native tab host is occluded by its fragment layer at the Android compositing
  level, regardless of renderer. So hoisting is impossible for the native bar.
- The native tab navigator also tears each scene's fragment down on switch
  (`remove+add`, rn-screens `TabsContainer`), so the per-screen background
  repaints from scratch every switch → an unavoidable flicker.

**Therefore, with the stack AS-IS: native bar + animated gradient + no flicker is
not achievable — pick two.** Seamless canvas themes require the JS bar. But the
goal remains "have our cake and eat it too" (native bar AND animated gradient AND
no flicker), so the full ledger below records every attempt and the avenues not
yet tried.

## Ledger: native bar + animated gradient + no flicker

The goal: a stylized canvas theme (e.g. aurora) running its animated gradient
behind the **native** bottom tab bar, with no flicker on tab switch.

### The two blockers

- **P1 — occlusion.** Anything hosted *behind* the native tab host (a sibling RN
  view drawn before `<NativeTabs>`) is not visible — the native tab host's
  fragment layer covers it.
- **P2 — teardown.** The native tab navigator swaps scenes with
  `it.remove(currentSelectedFragment) + it.add(nextSelectedFragment)` in one
  transaction (`react-native-screens` `gamma/tabs/container/TabsContainer.kt:561`),
  destroying the outgoing scene's view. There is **no JS prop** to keep scenes
  mounted (no `lazy`/`freezeOnBlur`/`detachInactiveScreens` equivalent for native
  tabs — grepped `src/components/tabs/`). So a per-screen background is rebuilt
  from scratch on every switch → flicker.

### Attempts and outcomes

| # | Approach | Result |
|---|----------|--------|
| 1 | Per-screen **WebGPU** canvas (original) | Gradient shows; black flash on switch, sometimes **stuck black** (render loop on a torn-down surface). Crash fixed via the webgpu patch + `useIsFocused` gating. Flicker (P2) remains. |
| 2 | **Hoist** WebGPU `TextureView` behind native tab host + transparent scenes | **Solid `--color-background`, no gradient** (P1). |
| 3 | Swap renderer to **RN views** (native `radial-gradient`) | Composites behind **JS** tabs (seamless). |
| 4 | **Hoist** RN-view background behind native tab host + transparent scenes | **Solid color, no gradient** too → P1 is renderer-independent. |
| 5 | Per-screen **RN-view** canvas on native tabs (current) | Gradient shows; repaints per switch → flicker (P2). |

Native layers checked (no opaque background found, yet hosted bg is still
occluded — the occluding layer is somewhere in the native fragment/host stack we
haven't pinned down): rn-screens gamma `TabsHost`/`contentView` `FrameLayout`/
`TabsScreen` set no background except the gated `nativeContainerBackgroundColor`
(expo-router never sets it); `WebGPUTextureView` is `setOpaque(false)`;
expo-router `ScreenContent` paints `colors.background` but it's overridable per
trigger via `contentStyle: transparent`.

### Untried avenues to actually get the cake (in rough priority)

- **A. Patch rn-screens to keep native tab scenes mounted** — change
  `TabsContainer.kt:561` from `remove/add` to `hide/show` (or `detach`/`attach`,
  or `setMaxLifecycle`) so the outgoing fragment's view survives. Then the
  per-screen, in-scene gradient never repaints → **no flicker (solves P2)**, and
  there's **no occlusion (sidesteps P1)** because the gradient lives *inside* the
  scene, not behind the host. Most promising. Risks: all tabs resident (memory),
  lifecycle correctness; would be a `bun patch` documented in
  `docs/bun-patches.md`. Prototype with hide/show first.
- **B. Find & clear the occluding layer (enables hoisting).** Inspect the live
  native view tree on a native-tab screen (Android Studio Layout Inspector /
  `uiautomator dump`) to identify which view paints opaque over a hosted
  background; if it's a settable background, clear it (a prop or an rn-screens
  patch). Solves P1 → one persistent hoisted background, fully seamless.
- **C. Gradient as the window/decor background.** Render the animated gradient
  below the entire RN surface (Android `decorView` background / a bottom-most
  `SurfaceView`) with the RN root + scenes transparent. A different compositing
  layer than RN siblings, so it may bypass P1. Native-side; animation needs a
  custom `Drawable` or a bottom SurfaceView.
- **D. Alternative native tab library.** `react-native-bottom-tabs` (cloned in
  `docs/cloned-repos-as-docs/react-native-bottom-tabs`) is a different native tab
  impl; check whether it keeps scenes mounted and/or lets a background composite
  through. Bigger swap (it's the tab navigator).

### Current shipped state

- Renderer flag `THEMED_BACKGROUND_RENDERER` in `ThemedBackground.tsx`
  (default `'views'`; `'wgpu'` kept for A/B).
- **JS bar:** hoisted RN-view gradient — seamless. (`JsTabsLayout`,
  `detachInactiveScreens={false}`.)
- **Native bar:** per-screen RN-view gradient — flickers on switch
  (`NativeTabsLayout` hosts nothing; `ThemedScreen` paints per-screen, focus-gated).
- iOS + JS-bar gradient fidelity (blobs, aurora motion, phosphor scanlines) still
  needs on-device verification.
