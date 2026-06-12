# GPU-library evaluation for the themed background (themes-refactor, problem 5, step 3)

**Status:** DECIDED + IMPLEMENTED (2026-06-12). Clones live in `docs/cloned-repos-as-docs/`
(`react-native-webgpu`, `typegpu`, `react-native-effects`, `react-native-shine`). This doc is
the step-3 deliverable from [themes-refactor.md](themes-refactor.md): a comparison of the
candidates and a recommendation.

> **Outcome:** the user chose to skip step-0 on-device profiling and replace the Skia chrome
> outright on the educated guess (animated-glow buttons = the breadth, aurora's clocked canvas
> = the depth). Option (b) — `react-native-effects` — is implemented, plus the glow downgrade
> to static `boxShadow` from option (a); Skia and react-native-animated-glow are removed from
> the app. See the status block in themes-refactor.md for what shipped and the remaining
> on-device verification list.

## What we'd be replacing (recap, from reading our code)

- `ThemedBackground.tsx`: one absolutely-filled Skia `<Canvas>` behind every `ThemedScreen`
  whenever the skin has blobs or scanlines. Three flavors:
  - **graphite** — 1 static radial blob (canvas paints once, then idles),
  - **phosphor** — 1 static blob + scanline SkSL shader (also static — no clock; `CustomTabBar`
    mounts a second `Scanlines` fill when the JS tab bar is active),
  - **aurora** — 3 blobs driven by `useClock()` + `useDerivedValue` → **repaints every frame,
    forever**, on every mounted screen (tab screens stay mounted, so unfocused tabs keep
    animating).
- `Button.tsx`: `react-native-animated-glow` (Skia, continuously animating) on primary `md`
  buttons for phosphor/graphite/aurora; a static `boxShadow` fallback already exists in the code.

So the only *continuously* animating chrome is aurora's blobs + the button glow. Phosphor and
graphite backgrounds are static content on a (cheap once-painted) GPU canvas.

## The candidates

### `react-native-webgpu` (wcandillon) — the foundation
v0.5.15; the `react-native-wgpu` name is a published shim that re-exports it (confirmed in
`packages/webgpu-shim/`). Dawn (chromium/7849) ships as prebuilt binaries fetched at build time
from the Shopify release CDN — all four Android ABIs, `minSdk 26`, **Vulkan-only on Android**
(no GL fallback; `cpp/rnwgpu/api/GPU.cpp` hardcodes the backend), **new-architecture only**.
Expo support is real (official `with-webgpu` template; autolinking, no config plugin). It can
drive WebGPU from the main JS runtime, the Reanimated UI runtime, or dedicated worklet runtimes —
the off-thread story is native to the foundation, not bolted on (there is no separate
"react-native-webgpu-worklets" package; it's built in via optional `react-native-worklets` /
`reanimated >= 4.2` peers). Its own example app uses `@shopify/react-native-skia` **2.6.2 — the
exact version we ship** — so Skia coexistence is exercised upstream. Actively maintained
(commits days old), single lead but Shopify/Expo-backed.

Adopting it alone means writing raw WebGPU (pipelines, buffers, WGSL) for three gradient
effects — most control, most code, and *we'd* own the render-loop/threading plumbing.

### TypeGPU (+ `@typegpu/react`) — the authoring layer
`typegpu` v0.11.8, SWM-backed, mature and active; on RN it sits **on top of
`react-native-wgpu`**. The hooks are real (`useRoot`, `useFrame`, `useUniform`, …) but
**`useFrame` is a plain JS-thread `requestAnimationFrame` loop**
(`packages/typegpu-react/src/core/use-frame.ts`) — no worklets integration. So the TypeGPU
route gives type-safe WGSL authoring (~100–180 LOC per effect) but does **not** by itself buy
the off-main-thread property that motivates this whole evaluation; we'd still have to marry it
to worklet runtimes by hand. Wrong trade for "three fixed background effects."

### `react-native-effects` (blazejkustra) — the drop-in
v0.2.0, explicitly experimental, effectively single-maintainer, no visible tests. Depends on
`react-native-webgpu` ^0.5 + `react-native-worklets` ^0.8 (no native code of its own). The
architecture is exactly the property we want: a shared **`BackgroundRuntime` worklet runtime**
runs the RAF render loop off the JS/main thread (`src/utils/backgroundRuntime.ts`,
`src/components/ShaderView/index.tsx`), GPU device/pipeline are created once and reused across
mounts, and **`isStatic` renders one frame and stops the loop** — so static themes pay no
per-frame cost even if we route them through it. Ships `Aurora`, `LinearGradient`,
`CircularGradient`, etc., plus `ShaderView` for raw WGSL.

Fit caveats found in source:
- `ShaderView`'s uniform surface is small (2 colors + 8 float params). Aurora's 3 blobs
  (3 × cx,cy,r + 3 colors) don't fit as uniforms — but blob geometry is *theme-constant*, so we'd
  generate the WGSL string per theme with the constants baked in. One `ShaderView` per screen
  composites all blobs + scanlines in a single pass; that's *fewer* layers than today's Skia tree.
- **No fallback when the WebGPU adapter is unavailable** (`useWGPUSetup` doesn't handle a null
  adapter) — on a Vulkan-less / broken-driver device the view silently renders nothing. We'd keep
  the current static path as the fallback and feature-detect.
- `minSdk 26` + Vulkan-only inherited from the foundation; our Mali history
  (cf. native-terminal-mali-blank-text-debug.md) makes real-device verification non-negotiable.

### `react-native-shine` (software-mansion-labs) — not a fit
v0.10.3-alpha.1; TypeGPU-based **card/image shine** effects (glare, holo) with gravity-sensor
input — a different product than full-screen background chrome. Pulls reanimated + worklets +
wgpu + typegpu. Worth knowing it exists; not a candidate for the `ThemedBackground` seam.

## Comparison against the criteria

| Criterion | cheap static fix | react-native-effects | TypeGPU (DIY) | raw react-native-webgpu |
|---|---|---|---|---|
| New native dep | **none** | Dawn (+worklets) | Dawn (+wgpu) | Dawn |
| Off-main-thread animation | n/a (nothing animates) | **yes, by default** (worklet runtime) | no (JS-thread `useFrame`) | possible, we build it |
| Covers blobs / scanlines / glow | blobs+scanlines yes, glow→static | yes / yes (WGSL) / yes (custom) | yes, all hand-written | yes, all hand-written |
| Code we write | ~a day, one file | small wrapper + per-theme WGSL strings | ~150 LOC × effect + plumbing | most |
| Expo prebuild | no change | prebuild, new-arch (we have it) | same | same |
| Android floor | unchanged | API 26, Vulkan-only, no auto-fallback | same | same |
| Maturity | n/a | **v0.2.0, experimental, bus factor 1** | core mature; RN glue thin | mature-for-the-space, Shopify/Expo-backed |
| Binary cost | zero | Dawn prebuilt `.so` per ABI — **unmeasured; must APK-diff in the spike** (agent size guesses conflicted, don't trust them) | same | same |
| Two GPU stacks carried | no (Skia stays for terminal) | yes (Skia + Dawn) | yes | yes |

## Recommendation

**(a) the cheap static fix first — it is probably the whole fix.** The code reading sharpened
the doc's hypothesis: only aurora's blobs and the button glow animate continuously, and they
keep animating on *unfocused* mounted tab screens. So before any new dependency:

1. Pause `AnimatedBlob` when the screen isn't focused (`useIsFocused`) — or drop the drift
   entirely and ship aurora static.
2. Swap `react-native-animated-glow` for the static `boxShadow` glow already wired in
   `Button.tsx` (one dependency deleted).
3. Optionally render static blobs via `expo-linear-gradient`/pre-baked image instead of a Skia
   canvas per screen — only if step-0 profiling shows static canvas *mounts* (not animation) are
   what costs on tab switch.

This is reversible, dependency-free, and lands behind the single-file seam. **Step 0 profiling
on the friend's device decides** whether it's sufficient: measure per theme before, after (1),
and after (2) — if tab switches recover, stop here.

**If animated motion is a hard product requirement** (the open decision in themes-refactor.md):
**(b) `react-native-effects`**, with eyes open. Its off-thread worklet render loop is the one
architectural property the Skia setup can't give us, its `isStatic` mode means static themes
don't regress, and `ShaderView` + generated WGSL covers blobs *and* scanlines in one pass.
Mitigations required: pin the version (v0.2.0, experimental), keep the current static renderer
as the WebGPU-unavailable fallback (it has none), verify on a low-end Mali device, and APK-diff
the Dawn binaries before committing. Option (c) (adding TypeGPU for the scanline) is unnecessary —
`ShaderView` already takes raw WGSL; TypeGPU only earns its place if we start writing many or
interactive effects, and its React loop is main-thread anyway.

Not recommended: raw `react-native-webgpu` (we'd re-implement react-native-effects badly) and
`react-native-shine` (wrong product).
