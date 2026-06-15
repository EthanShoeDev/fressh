# Themed animated gradient background + the native tab bar

Status as of 2026-06-15. This doc was previously titled "Debugging the WebGPU
themed background on Android" and had drifted into a WebGPU-crash war diary. It's
refocused here around the actual product goal and the one problem still open.

## The goal

Two things, both simple on their own:

1. **The app supports two bottom tab bars and the user picks one:** a fully
   theme-styled **custom JS bar** (`JsTabsLayout` + `CustomTabBar`) and the
   **native platform bar** (Material on Android / liquid-glass on iOS,
   `NativeTabsLayout`). `(tabs)/_layout.tsx` chooses between them.
2. **Some themes have an animated radial-gradient background** behind everything,
   including behind the tab bar. These are the "canvas" themes (aurora / phosphor
   / graphite, gated by `skinHasCanvas()`); the others are flat.

The one hard requirement that ties them together: **the gradient must stay alive
across tab switches** — no reload, no black flash, no flicker.

That's it. An animated radial gradient is not, by itself, hard. The difficulty is
entirely in **how the bottom tab bar hosts (and tears down) the views behind it.**

## The renderer: how we got here, and why it's now plain RN views

The gradient renderer went through three iterations. The takeaway up front: **the
renderer was never the hard part, and we've landed on the boring one.**

1. **Skia.** The original renderer (React Native Skia). On one test device,
   switching tabs lagged badly — Skia's draw competed with the JS/main thread.

2. **WebGPU fragment shader.** Migrated to a WGSL shader via
   `react-native-effects`' `ShaderView` (backed by `react-native-webgpu` / Dawn).
   Its render loop runs on a background worklet runtime, so aurora's blob drift
   no longer competed during tab switches. It looked great **on the JS bar**. But
   a WebGPU surface has its own native lifecycle, and that lifecycle *fights the
   native tab bar*: on Android the surface is torn down when a tab hides, so
   coming back is a from-scratch re-init (black, then a frame ~1s later), and a
   mid-teardown frame could SIGSEGV in Dawn (fixed with a `bun patch`, see
   appendix). For a *soft animated gradient* this is far more machine than the job
   needs — the shader's premium is sharp procedural detail we don't use.

3. **RN-view radial gradient — the current default.** Each gradient blob is an
   ordinary `View` painted with a **native `radial-gradient`**
   (`experimental_backgroundImage`, RN 0.85+); aurora's drift is a Reanimated
   transform on the UI thread. Scanlines are a tiled native `linear-gradient`.
   Because it's just RN views, it composites in the normal view tree behind
   **both** tab bars, has **no GPU surface to tear down** (no black flash, no
   teardown crash, no Dawn patch), and needs **no new dependency**. It loses
   nothing visible for a soft gradient. Implementation: `ThemedBackground.views.tsx`.

   > Not `expo-linear-gradient`: that package only does *linear* gradients. The
   > radial gradient here comes from React Native core's native
   > `experimental_backgroundImage: [{ type: 'radial-gradient', … }]`, so there's
   > no extra dependency at all.

Both renderers still live in the tree, selected by one constant
`THEMED_BACKGROUND_RENDERER` in `ThemedBackground.tsx` (default `'views'`;
`'wgpu'` kept only for A/B comparison). `ThemedBackground` is the single seam —
screens never know which renderer is mounted.

## The actual problem: native tab bar + gradient + no flicker

**The JS bar is solved.** `JsTabsLayout` hoists ONE persistent `ThemedBackground`
above the navigator so it never unmounts; the scenes, their nested stacks, and
`ThemedScreen` all stay transparent (`CanvasHoistedContext`) so it shows through;
and `detachInactiveScreens={false}` makes a switch a pure visibility flip. Result:
seamless animated gradient under the custom bar.

**The native bar is not solved.** Canvas themes on the native bar fall back to a
*per-screen* gradient (`ThemedScreen`), which flickers on every switch. Two
distinct blockers, both rooted in how the native tab navigator works on Android:

- **P2 — teardown.** Expo's native tabs destroy the outgoing tab's view on every
  switch, so a per-screen gradient repaints from scratch → flicker. (Details and
  the surprising fix below.)
- **P1 — occlusion.** A gradient *hoisted behind* the native tab host showed a
  solid background color and no gradient on device — twice, with both the WebGPU
  `TextureView` and a plain RN view. So hoisting one persistent background behind
  the native bar appeared impossible. (The library investigation below complicates
  this conclusion — see the note on P1.)

With the stack **as-is**, native bar + animated gradient + no flicker is not
achievable — you can have any two. Seamless canvas themes therefore require the
JS bar today. But the goal is to have all three, so the rest of this doc is the
investigation into how.

## Investigation: the two native-tab libraries

We use Expo's native tab bar today, but there's a second, independent native-tab
library from Callstack. The question: **does one of them let us host a persistent
gradient that survives tab switches, and why?** Both are cloned under
`docs/cloned-repos-as-docs/` for source reading (un-minified, with docs).

### What each one actually is

- **"Expo native tabs"** = `expo-router/unstable-native-tabs`, which is a thin JS
  wrapper. On Android it renders via **`react-native-screens` "gamma" BottomTabs**
  (`com.swmansion.rnscreens.gamma.tabs`, currently v4.25.2). It is *not* its own
  native module. Source:
  `docs/cloned-repos-as-docs/react-native-screens/android/src/main/java/com/swmansion/rnscreens/gamma/tabs/`.
- **"Callstack native tabs"** = **`react-native-bottom-tabs`** (`com.rcttabview`).
  A standalone native tab implementation. Source:
  `docs/cloned-repos-as-docs/react-native-bottom-tabs/packages/react-native-bottom-tabs/`.

On the lineage hunch ("they were the same and Expo forked away"): the source
doesn't show a shared fork — they're **independent implementations**. Both
ultimately drive the same *platform* widget (Material `BottomNavigationView` on
Android, `UITabBarController` on iOS), but the React Native integration layers are
written separately, and they diverge on the one thing that matters to us:

### The decisive difference — scene lifecycle

| | Expo / react-native-screens gamma | Callstack / react-native-bottom-tabs |
|---|---|---|
| Scene model | One **fragment per tab**; a switch runs `remove(outgoing) + add(incoming)` in one transaction — `TabsContainer.kt:558-563` | One `LinearLayout`; every visited tab's view stays added to `layoutHolder`, a switch just flips `View.GONE`/`VISIBLE` — `RCTTabView.kt:186-210` |
| Keeps inactive scenes mounted? | **No**, and there's **no JS prop** to opt in (no `lazy`/`freezeOnBlur`/`detachInactiveScreens` for gamma tabs) | **Yes.** `lazy` (default `true`) mounts a tab on first visit then keeps it; `freezeOnBlur` (default `false`) only pauses React reconciliation, views stay attached |
| Teardown flicker (P2) | **Inherent** — outgoing view destroyed every switch | **None** — no remove/add on switch |
| Content-area background | Transparent by default (`TabsHost`/container/`contentView` paint nothing unless `nativeContainerBackgroundColor` is set) | Transparent (containers paint nothing) |
| Only opaque layer | The bottom-bar band — `TabsAppearanceApplicator.kt:39-42` sets it unconditionally | The Material bar band; can pass a transparent `barTintColor`, or hide the native bar entirely via `renderCustomTabBar` → `tabBarHidden` (`TabView.tsx:407,470`) |

### The headline

**`react-native-bottom-tabs` keeps every scene mounted and never runs a remove/add
transaction on a tab switch** (`RCTTabView.kt:156-210`: children are added once to
`layoutHolder`, switching is `View.GONE`/`VISIBLE`). That removes **P2 — the
teardown flicker — for free**, which is exactly the problem Expo's
react-native-screens gamma *cannot* avoid without patching its fragment
transaction. And because its content area paints no background, a gradient hosted
as a sibling *behind* the tab view composites through. The only opaque obstacle is
the tab-bar band itself, and that's bypassable (`renderCustomTabBar` hides the
native bar; or a transparent `barTintColor`).

So **the most promising path to "native bar + animated gradient + no flicker" is
to swap the native bar from Expo's native tabs to `react-native-bottom-tabs`.**

### A note on P1 (occlusion) — the earlier conclusion is suspect

The earlier doc concluded, from two on-device tests, that *anything* behind the
native tab host is occluded at the Android compositing level regardless of
renderer. But reading the react-native-screens source, the
`TabsHost → TabsContainer → contentView` chain is **transparent by default** — the
only opaque layer is the bottom-bar band (`TabsAppearanceApplicator.kt:39-42`); the
container only gets a background if JS sets `nativeContainerBackgroundColor`
(`TabsHost.kt:52-56`), which expo-router doesn't. So the on-device "solid
background, no gradient" we saw was probably **not** a hard compositing-level
occlusion of the whole host — more likely an opaque paint from a settable layer
(expo-router's per-screen `colors.background`, or the fragment's own background).
That's worth re-checking, but it's moot if we move to `react-native-bottom-tabs`,
where scenes never tear down in the first place.

## Options and recommendation

1. **Ship JS bar for canvas themes (current state, works).** Native bar stays for
   the Native theme (which has no canvas anyway). Lowest risk; already done.
2. **Swap the native bar → `react-native-bottom-tabs`** *(recommended path to the
   full goal)*. It keeps scenes mounted, so one persistent gradient hosted behind
   it survives switches → seamless on *both* bars. This is the only option that
   gets "have your cake and eat it too." Cost: it replaces the native navigator
   (bigger swap), and iOS behavior + the tab-bar-band transparency need verifying.
3. **Patch react-native-screens gamma.** Change the switch transaction from
   `remove/add` to `hide/show` (`TabsContainer.kt:560-562`), relax the
   single-fragment invariant (`TabsContainer.kt:639-654`), and make the bar
   background transparent (`TabsAppearanceApplicator.kt:39-42`). Keeps Expo's
   native tabs but becomes a maintained `bun patch` (document in
   `docs/bun-patches.md`).

Given the default tab bar is already `js` and the JS path is already seamless,
**option 1 is the shipped baseline and option 2 is the next experiment** if we
want canvas themes on the native bar.

## Current shipped state

- Renderer: `THEMED_BACKGROUND_RENDERER = 'views'` (RN-view radial gradient);
  `'wgpu'` retained behind the flag for A/B.
- **JS bar:** hoisted RN-view gradient — seamless (`JsTabsLayout`,
  `detachInactiveScreens={false}`).
- **Native bar:** per-screen RN-view gradient — flickers on switch
  (`NativeTabsLayout` hosts nothing; `ThemedScreen` paints per-screen,
  focus-gated).
- iOS gradient fidelity (blob geometry, aurora motion, phosphor scanlines) still
  needs on-device verification.

---

## Appendix: the WebGPU detour (kept for the record)

The `'wgpu'` renderer is still in the tree behind the flag, so its supporting
changes remain. These are *not* part of the gradient design; they're here so the
working tree makes sense.

- **`patches/react-native-webgpu@0.5.15.patch`** — pins the NDK to the project's
  (webgpu didn't honor `rootProject.ext.ndkVersion`) and, more importantly, fixes
  a teardown SIGSEGV: when a tab hides mid-frame the surface is nulled but the
  off-thread render loop fires one more `getCurrentTexture().createView()` →
  null-deref in Dawn. The patch returns a throwaway texture instead of null (and
  a null backstop in `createView` that *returns*, not throws — throwing just
  turned the SIGSEGV into a SIGABRT on the worklet runtime). Full rationale:
  `docs/bun-patches.md`.
- **`apps/mobile/metro.config.js`** — relocates Metro's transform + file-map
  caches into `node_modules/.cache/metro/…` (which `git clean -fxd` actually
  removes) so a clean doesn't leave a stale cache referencing deleted
  `react-native-worklets/.worklets/<id>.js` files → `ENOENT` on next bundle.
  Reuses Expo's binary `FileStore` and pre-creates the dirs. Operational note:
  never wipe `.worklets` or the Metro cache while a Metro dev server is running —
  the in-memory cache survives and re-ENOENTs; stop Metro first.

If we commit to the RN-view renderer permanently and drop `'wgpu'`, both of these
can go (and the webgpu dependency + patch with them).
