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

**The native bar is now solved too — the "flicker" was self-inflicted.** Canvas
themes on the native bar render a *per-screen* gradient (`ThemedScreen`). That
flashed black on every switch, and we spent a long time blaming the native tab
navigator's fragment teardown (P2 below). It was actually **our own code**: a
`useIsFocused()` gate in `ThemedScreen` *unmounted* the gradient the moment a
screen blurred, so during a switch the flat, opaque per-screen `--color-background`
flashed through. Removing that gate makes the RN-view gradient **seamless on the
native bar** (device-confirmed 2026-06-15). Details:

- **The real cause — an app-level focus-gate.** `ThemedScreen` rendered the canvas
  only while `useIsFocused()`. On a tab switch the outgoing screen blurs first, its
  `<ThemedBackground/>` unmounted, and the bare opaque `background` showed for the
  transition frames — read as a black flash. That gate existed **only** to work
  around a WebGPU teardown crash (see P2) and was wrongly applied to *every*
  renderer. It has been **ripped out** (2026-06-15): the canvas now stays mounted
  while blurred, and the correct crash mitigation is the react-native-webgpu Dawn
  `bun patch` (`docs/bun-patches.md`) — not manual unmount/remount in app code.

- **P2 — fragment teardown (Android) only bites a GPU surface.** On Android the
  native tab navigator swaps scenes with a fragment transaction —
  `remove(outgoing) + add(incoming)` per switch (`TabsContainer.kt:558-563`). The
  JS tree stays mounted ([expo/expo#40131](https://github.com/expo/expo/issues/40131)),
  but the **native view** is detached and re-attached. For an **RN view** that
  re-attach is a synchronous one-frame repaint → **no flicker**. For a **WebGPU
  surface** the detach *destroys the surface* and the re-attach triggers an async
  Dawn re-init (~1s black, then a frame) → an unavoidable flash, no matter what the
  app does (keeping the React component mounted doesn't keep the native surface
  alive — the fragment manager detaches it regardless). So the teardown only
  flickers the `wgpu` renderer — which is exactly why we ship `views`. (iOS has no
  teardown: `UITabBarController` keeps scenes alive.)

- **P1 — occlusion is moot for the shipped path.** Because canvas themes render the
  gradient *inside each screen* (not hoisted behind the bar), the old question of
  whether anything shows through *behind* the Expo native bar no longer matters. We
  did observe a hoisted background painting opaque behind the Expo bar on Android,
  but that path isn't used — per-screen rendering sidesteps it entirely.

**Net: native bar + animated gradient + no flicker is achieved** with the RN-view
renderer, once the focus-gate is gone. The Callstack library swap (investigated
below) is **no longer required** for this goal — it stays on record as an
alternative, not a blocker.

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
| Content-area background (Android) | Source container is transparent (paints nothing unless `nativeContainerBackgroundColor` is set), **but on device via Expo Router the scene painted opaque** — a hoisted background did not show through (P1, empirically confirmed). Likely an opaque per-screen/fragment paint in the Expo wiring, not a hard compositor occlusion. | **Transparent** — scenes are `GONE`/`VISIBLE` over a transparent holder, so a sibling background behind the tab view composites through ([#374](https://github.com/callstack/react-native-bottom-tabs/issues/374)) |
| Content-area background (iOS) | Transparent (`UITabBarController`) | **Opaque white by default** ([#374](https://github.com/callstack/react-native-bottom-tabs/issues/374)); a background behind it is hidden unless applied **per-screen** via each `Tab.Screen`'s `layout` prop. (Harmless for no-flicker: iOS keeps scenes alive, so per-screen doesn't tear down.) |
| Only opaque bar layer | The bottom-bar band — `TabsAppearanceApplicator.kt:39-42` sets it unconditionally | The Material bar band; pass a transparent `barTintColor`, or hide the native bar entirely via `renderCustomTabBar` → `tabBarHidden` (`TabView.tsx:407,470`) |
| Keep-mounted opt-outs | None (teardown is the non-negotiable default) | `unmountOnBlur` ([#70](https://github.com/callstack/react-native-bottom-tabs/issues/70)) and `freezeOnBlur` ([#71](https://github.com/callstack/react-native-bottom-tabs/issues/71)) are *opt-in* — keep-mounted is the default |

### The headline

**`react-native-bottom-tabs` keeps every scene mounted and never runs a remove/add
transaction on a tab switch** (`RCTTabView.kt:156-210`: children are added once to
`layoutHolder`, switching is `View.GONE`/`VISIBLE`). That removes **P2 — the
teardown flicker — for free**, which is exactly the problem Expo's
react-native-screens gamma *cannot* avoid without patching its fragment
transaction.

The show-through, though, is **per-platform asymmetric** — and the asymmetry is
the mirror image of Expo's:

- **Android:** Callstack's scene is **transparent**, so a gradient hosted *behind*
  the tab view composites through ([#374](https://github.com/callstack/react-native-bottom-tabs/issues/374)).
  This is the opposite of Expo's bar, which painted opaque on Android (P1).
- **iOS:** Callstack's scene is **opaque white by default**
  ([#374](https://github.com/callstack/react-native-bottom-tabs/issues/374)); a
  hoisted background is hidden, so on iOS you render the gradient **per-screen**
  via each `Tab.Screen`'s `layout` prop. That's fine for no-flicker — iOS keeps
  scenes alive, so per-screen never tears down.

So the seamless-gradient mechanism would differ by platform under Callstack: **one
hoisted background on Android, per-screen backgrounds on iOS** — but both reach
"no flicker." The only remaining opaque obstacle, the tab-bar band, is bypassable
(`renderCustomTabBar` hides the native bar; or a transparent `barTintColor`).

So **the most promising path to "native bar + animated gradient + no flicker" is
to swap the native bar from Expo's native tabs to `react-native-bottom-tabs`** —
*if* we decide the gradient-on-native-bar goal is worth leaving Expo's navigator.

### Integration & known issues (from the trackers)

Callstack ships a **first-party Expo Router adapter** — `@bottom-tabs/react-navigation`'s
`createNativeBottomTabNavigator` wrapped with Expo Router's `withLayoutContext`
(official [Expo Router guide](https://oss.callstack.com/react-native-bottom-tabs/docs/guides/usage-with-expo-router);
there's an `@bottom-tabs/expo-template` in the repo). So the swap keeps Expo Router
— only the navigator underneath `(tabs)/_layout.tsx` changes. Caveats and relevant
issues, found via `gh`:

- **Not supported in Expo Go**; needs a dev build + its config plugin
  (`"plugins": ["react-native-bottom-tabs"]`) and a native rebuild. (Non-issue for
  us — we already run dev builds.)
- **Android theme** must inherit `Theme.Material3.DayNight.*`; with
  `react-native-edge-to-edge` set `parentTheme: 'Material3'`. Check against our
  `styles.xml`.
- **[#123](https://github.com/callstack/react-native-bottom-tabs/issues/123)
  (Android, closed)** — a direct consequence of the keep-mounted-but-`GONE` model:
  an inactive (`GONE`) view measures 0×0, so size-sensitive content (FlashList, and
  anything that measures on mount) can get bad dimensions mid-transition. Relevant
  to our terminal/list screens.
- **[#220](https://github.com/callstack/react-native-bottom-tabs/issues/220)
  (closed)** — the Expo Router + iOS integration has broken on a version bump
  before (`0.7.7` regression). Pin deliberately.
- **[#463](https://github.com/callstack/react-native-bottom-tabs/issues/463)**
  (iPad/iPadOS 26 duplicate custom bar), **[#224](https://github.com/callstack/react-native-bottom-tabs/issues/224)**
  (modal-over-tabs layout shift on iOS), **[#380](https://github.com/callstack/react-native-bottom-tabs/issues/380)**
  (custom-bar height measurement of absolutely-positioned children) — only bite if
  we hide the native bar and draw our own.

No issue reports Callstack *unmounting* inactive Android scenes — consistent with
the source. The opposite complaint exists for Expo's bar
([expo/expo#40131](https://github.com/expo/expo/issues/40131)).

### A note on P1 (occlusion) — source vs. what we measured

Empirically, on **Expo's bar + Android**, a hoisted background does not show
through (solid background color, both renderers). That's the fact we build on.

The *source* doesn't fully explain why: the rn-screens
`TabsHost → TabsContainer → contentView` chain is **transparent by default** — the
only opaque layer is the bottom-bar band (`TabsAppearanceApplicator.kt:39-42`); the
container only gets a background if JS sets `nativeContainerBackgroundColor`
(`TabsHost.kt:52-56`), which expo-router doesn't. So the on-device opacity is
probably **not** a hard compositor occlusion of the whole host but an opaque paint
from a *settable* layer in the Expo wiring (expo-router's per-screen
`colors.background`, or the fragment's own background). In principle that could be
made transparent; in practice we couldn't find the lever, so the working
conclusion stands: **on Expo's native bar, canvas themes render the gradient
per-screen.** (Callstack sidesteps this on Android by being transparent there;
on iOS it's per-screen by necessity — see the headline.)

## Resolved: the device test, and why the swap is unnecessary

The whole P1/P2 framing — and the "swap libraries" case — was built when the
renderer was a **WebGPU surface**, whose teardown cost was severe (a ~1s black
re-init plus the SIGSEGV the Dawn patch fixes). Once the renderer became RN views
*and* the focus-gate was removed, the device test settled it (2026-06-15, on the
Android device that originally lagged with Skia):

- **Native bar + `views` renderer + animated aurora gradient: no flicker.** Switch
  tabs repeatedly → the gradient holds steady, no flat/black flash. This is with
  the focus-gate removed from `ThemedScreen` (the gate was the flicker).
- **Native bar + `wgpu` renderer: no flicker *either*, but it CRASHES.** My earlier
  prediction that `wgpu` would still flash was **wrong** — keeping the ShaderView
  mounted preserves the WebGPU context, so the fragment re-attach is a cheap surface
  reconfigure, not the cold ~1s re-init the *unmounting* focus-gate used to force.
  But the flip side of keeping it mounted is the blurred tab's render loop hits the
  torn-down surface on a switch and **crashes** (reproduced on device). The Dawn
  patch turns the original SIGSEGV into a no-op but evidently doesn't cover every
  teardown path. So `wgpu` is still unusable on the native bar — now for a *crash*,
  not a flicker.
- Performance with `views` is fine — the Skia lag that started the saga was
  renderer-specific; a native `radial-gradient` + a UI-thread Reanimated drift is
  cheap.

So the goal — **native bar + animated gradient + no flicker — is met by the shipped
`views` renderer**, no library swap, no navigator change, no extra dependency. And
`views` has no GPU surface, so it carries none of `wgpu`'s native-bar crash risk.

Aside (why we removed the gate anyway, given `wgpu` still can't use the native bar):
the focus-gate was an app-level band-aid over a native lifecycle problem, and it was
breaking the renderer we *do* ship (`views`). The correct mitigation for the `wgpu`
teardown is the native `bun patch`, not an unmount hook in React. We ship `views`;
`wgpu` stays JS-bar-only behind the flag.

## Options (recommendation: option 1, now shipped)

Ethan's call: **stay on Expo's native tabs for long-term maintainability** (it's
the first-party navigator, tracks Expo Router/SDK upgrades, no extra native module).
The device test makes that free — we get the full goal without leaving Expo's bar.

1. **Stay on Expo's bar; render canvas gradients per-screen with the RN-view
   renderer; keep the canvas mounted across blur** *(shipped — the goal is met)*.
   No new dependency, no navigator swap. The flicker is gone because the focus-gate
   is gone.
2. **Ship JS bar for canvas themes.** Still the seamless hoisted path for the custom
   bar; unchanged. Not a fallback anymore — the two bars are now both seamless.
3. **Swap the native bar → `react-native-bottom-tabs`** *(no longer needed)*. Kept
   on record only as an alternative if we ever want a *hoisted* (not per-screen)
   background behind the native bar. Mechanism is per-platform and it adds the
   upgrade-tracking burden Ethan wants to avoid. See "Integration & known issues."
4. **Patch react-native-screens gamma** (`remove/add` → `hide/show`). Moot — there's
   no flicker left to fix. Recorded for completeness only.

## Current shipped state

- Renderer: `THEMED_BACKGROUND_RENDERER = 'views'` (RN-view radial gradient);
  `'wgpu'` retained behind the flag for A/B only.
- **JS bar:** hoisted RN-view gradient — seamless (`JsTabsLayout`,
  `detachInactiveScreens={false}`).
- **Native bar:** per-screen RN-view gradient — **seamless** (`NativeTabsLayout`;
  `ThemedScreen` paints per-screen and keeps the canvas mounted across blur). The
  former `useIsFocused()` focus-gate — the cause of the flicker, and only ever a
  `wgpu` crash workaround — has been removed; the crash is handled by the
  react-native-webgpu Dawn `bun patch` instead.
- iOS gradient fidelity (blob geometry, aurora motion, phosphor scanlines) still
  needs on-device verification.
- **Debug aid still in tree:** `src/lib/theme-debug.ts` (`DEBUG_RENDERER_TINT`)
  tints each renderer a distinct color (views = magenta, wgpu = cyan). Set it
  `false` (or delete the file + its two imports) to restore real theme colors.

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
