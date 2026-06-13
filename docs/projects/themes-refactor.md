# Project: themes refactor — native-first default, fix the rough edges, kill the tab-switch lag

**Status:** IN PROGRESS (2026-06-12) — problems 1–4 implemented; problem 5 research done,
implementation gated on step-0 profiling. This doc records the problems, their root causes
(with file:line), and the direction for each.

- **Problem 1 ✅** — `DEFAULT_THEME` is now `native`; separate `appearance` pref
  (`'system' | 'light' | 'dark'`, `preferences.tsx`) consulted by `resolveUniwindTheme` and read
  in `initAppTheme()` (no cold-start flash). `useAppTheme()` exposes `appearance`/`setAppearance`.
- **Problem 2 ✅** — went with option (a): on Native, the pinned swatch grid is gone; Settings has
  an "Appearance" `NativeNavRow` → new `settings/appearance` screen (theme select rows +
  System/Light/Dark segmented control, all inside the scrolling `NativeForm`). Swatch grid
  extracted to `components/theme-grid.tsx`, still used by the stylized path.
- **Problem 3 ✅** — `<Text maxLines={1}>` in `native-segmented-control.android.tsx` (note: the
  jetpack-compose `Text` prop is `maxLines`; `numberOfLines` only exists on the universal
  `@expo/ui` Text). Same one-line guard added to the custom `Segmented`.
- **Problem 4 ✅** — `useThemedHeader` now sets `headerBackTitle` derived from the parent tab's
  `TAB_ROUTES` label (via `useSegments`), themed casing applied; `headerBackButtonDisplayMode:
  'minimal'` fallback outside a known tab. All four tab stacks get it with no per-layout edits.
- **Problem 5 ✅ (implemented, on-device verification pending)** — research in
  [themes-refactor-gpu-eval.md](themes-refactor-gpu-eval.md). **Decision: skipped step-0
  profiling** (user call, 2026-06-12) and went straight to the educated guess: the common factor
  across all laggy themes was the continuously-animating `react-native-animated-glow` buttons,
  with aurora's `useClock` blob canvas stacking on top. Both Skia suspects are gone:
  - `ThemedBackground` now renders via `react-native-effects` `ShaderView` (WebGPU, render loop
    on a background worklet runtime; `isStatic` for non-aurora themes — one frame then the loop
    stops). Per-theme WGSL is generated with blob constants baked in; same single-file seam.
  - `Button` uses the static `boxShadow` glow; `react-native-animated-glow` and
    `@shopify/react-native-skia` are removed from the app entirely (the terminal renderer never
    used Skia).
  - Setup that came with it: worklets **Bundle Mode** (babel.config.cjs + metro wrap +
    `worklets.staticFeatureFlags` in package.json), `expo-build-properties` minSdk 26 (drops
    Android 7.x), and a `bun patch` on react-native-effects forwarding `transparent` to the
    webgpu `Canvas` (upstream consumes the prop for clearValue but never marks the native
    surface transparent — needed because the ShaderView overlays the theme's background color).
  - **Needs a native rebuild** (`expo prebuild` + run) and a real-device pass: verify the
    overlay compositing, the Mali/Vulkan story (no-adapter devices gracefully fall back to the
    flat background color — the canvas just never presents), and that aurora actually animates
    off-thread.

**Scope:** `apps/mobile` only. The theming system lives entirely in JS/RN — no native (Rust /
`react-native-terminal`) change is implied by anything here.

## Background — how theming works today

One source of truth, `src/lib/theme.tsx`, defines five selectable themes via `APP_THEMES`:
four stylized dark themes (**phosphor**, **graphite**, **aurora**, **monolith**) and **native**
("feels like the OS" — real `@expo/ui` SwiftUI / Material 3 controls, system palette that
follows device light/dark). The palettes are uniwind `@variant` blocks in `src/global.css`
(registered in `metro.config.js`); the theme is persisted to MMKV (`preferences.theme`,
`src/lib/preferences.tsx`) and applied via `Uniwind.setTheme()`.

Two layers carry each theme's "voice" beyond color:
- **`src/lib/theme-skin.ts`** — per-theme non-color design (radius, casing, fonts, gradient
  blobs, scanlines, glass, glow). `useThemeSkin()` / `useIsNativeTheme()` are read all over.
- **GPU-drawn chrome** — `src/components/themed/ThemedBackground.tsx` (Skia canvas: radial
  gradient blobs + a CRT-scanline SkSL shader, rendered behind every `ThemedScreen`) and
  `src/components/themed/Button.tsx` (primary `md` buttons get a `react-native-animated-glow`
  bloom on themes that define `skin.glowColor`).

`resolveUniwindTheme()` already splits **native** into `native` / `native-light` by device
appearance; `useSystemThemeSync()` keeps it live. So the light/dark *plumbing* for native
already exists — the gap (problem 1) is purely in the picker UX.

Relevant prior art: [native-ui-theme-or-themes.md](complete/native-ui-theme-or-themes.md),
[ui-overhaul.md](complete/ui-overhaul.md), [preview-terminal-theme.md](complete/preview-terminal-theme.md).

---

## Problem 1 — native should be the default, with an in-app light/dark choice

**Today:** `DEFAULT_THEME` is `graphite` (`src/lib/preferences.tsx`), and **native** is just
one of five swatches. Native already follows the OS scheme (`resolveUniwindTheme` →
`native` / `native-light`), but the user can't *force* native-light or native-dark — it only
ever tracks the system, and it isn't the first thing a new user sees.

**Direction:**
- Flip `DEFAULT_THEME` to `native` so a fresh install feels like a stock OS app.
- Give native three modes — **System / Light / Dark** — instead of system-only. This means a
  stored preference beyond the single `theme` string. Options to decide between:
  - a separate `appearance: 'system' | 'light' | 'dark'` pref consulted by `resolveUniwindTheme`
    (cleanest — orthogonal to theme; could later let stylized themes opt into light too), or
  - expand the theme enum with explicit `native-light` / `native-dark` entries (simpler, but
    leaks the "native is special" branching further).
  - **Leaning toward the separate `appearance` pref** — it keeps `AppThemeName` clean and the
    override generalizes.
- Settings UI: when native is selected, show a System/Light/Dark control (a 3-way segmented
  control fits — and on native that's the `@expo/ui` segmented control, see problem 3).
- Verify the no-flash startup path still holds: `initAppTheme()` reads `Appearance.getColorScheme()`
  at module load; a forced light/dark override has to be read there too, or native users see a
  scheme flash on cold start.

**Open question:** does forcing light/dark apply only to native, or do we also want a light
variant of the stylized themes? Current `global.css` only defines dark palettes for the four
stylized themes (plus uniwind's base light/dark, which the app never selects). Out of scope
unless we decide otherwise — note it and move on.

---

## Problem 2 — the theme picker doesn't scroll with the page (native theme)

**Today:** `src/app/(tabs)/settings/index.tsx` branches on `useIsNativeTheme()`:
- **`CustomSettings`** (stylized themes) puts everything — including the `ThemeGrid` — inside one
  `<ScrollView>` (line 116). Scrolls fine.
- **`NativeSettings`** (native theme) can't: RN views can't live inside the `@expo/ui` `<Host>`
  form, so the `ThemeGrid` is rendered in a **fixed** `<View className='px-4 pt-2'>` *above* the
  `<NativeForm>` (lines 59–64). The form scrolls; the theme grid is pinned and does not move with
  it. That's the "theme cards don't scroll with the rest of the content" bug, and it looks worst
  on native because the swatch grid (designed for the stylized look) sits awkwardly above a stock
  system form.

**Direction (needs a decision — see options):**
- **(a) Move theme selection out of the form into a native list/menu.** On native, drop the
  custom swatch grid entirely and present themes the OS way — a `NativeNavRow` "Appearance" →
  pushes a sub-screen, or a native `Picker`/menu row *inside* `NativeForm` so it scrolls with
  everything else. Most "native-correct", removes the pinned-view problem by construction.
- **(b) Make the whole native screen one scroll surface.** Wrap header + grid + form in a
  scroll container so the grid scrolls with the form. Fights the `@expo/ui` `<Host>` constraint
  (the form wants to own its own scrolling); likely to feel janky with nested scroll.
- **(c) Keep the grid but make it not look bad pinned** — small, polished, clearly a header
  element. Cheapest, least satisfying.
- **Leaning (a):** on native, themes belong in a native control, not a custom swatch grid. This
  also dovetails with problem 1 (System/Light/Dark lives in the same native Appearance screen).
  The stylized-theme path keeps the swatch grid (it already scrolls correctly).

---

## Problem 3 — cursor-style segmented control wraps on narrow Android devices (native theme)

**Today:** `src/app/(tabs)/settings/terminal.tsx` native path (line ~130) renders the cursor
picker via `NativeSegmentedRow` (layout `stack`, full width) → `NativeSegmentedControl`
(`src/components/native-segmented-control.android.tsx`), a Material 3
`SingleChoiceSegmentedButtonRow` of `SegmentedButton`s. Options are
`CURSOR_STYLES = Block / Beam / Underline / Hollow` (4 items, `src/lib/preferences.tsx`). The
`<SegmentedButton.Label><Text>{label}` has **no `maxLines` / ellipsize**, so on a narrow device
"Underline" wraps to two lines and blows up that one segment's height — the control looks
lopsided.

**Direction (any/all):**
- Constrain the label `Text` to a single line — **concrete, verified fix:** the `@expo/ui` `Text`
  exposes `numberOfLines`, which maps straight to Compose `maxLines` with ellipsis truncation
  (`docs/cloned-repos-as-docs/expo/packages/expo-ui/src/universal/Text/index.android.tsx:48`,
  `…/Text/types.ts:82`). So `<Text numberOfLines={1}>` inside `SegmentedButton.Label` in
  `native-segmented-control.android.tsx` makes it truncate instead of wrap — first thing to try.
- Or shorten labels for narrow widths ("Underln"/"U"? — ugly; prefer truncation or an icon).
- Or, for 4-up controls that don't fit, fall back to a stacked radio list (native `Picker` /
  list rows) below some width threshold.
- Check the same control for `CURSOR_BLINKS` and any other ≥4-option native segmented row — this
  is a general `NativeSegmentedControl` robustness fix, not a one-off. The custom (`Segmented`,
  `src/components/settings-controls.tsx`) path uses `flex-1` buttons and has the analogous risk;
  audit both.

---

## Problem 4 — back button shows the route filename ("index") instead of a friendly label

**Today:** stack layouts (`src/app/(tabs)/*/_layout.tsx`) set `headerShown: false` on `index`
(each tab root draws its own inline `ScreenHeader`) and give child screens a `title` via
`useThemedHeader().title(...)`. But **no `headerBackTitle` is set anywhere.** When a child
screen (e.g. `settings/terminal`, `settings/known-hosts`, `servers/diff`) shows the native stack
header, the back button label defaults to the *previous route's* identity — which is the `index`
route whose header is hidden, so it surfaces the raw route name **"index"** (most visible on iOS,
where the back button shows a text label). Confirmed layouts:
`settings/_layout.tsx`, `servers/_layout.tsx`, plus `keys`/`commands`.

**Direction:**
- Add `headerBackTitle` (RN-screens / expo-router) to each child `Stack.Screen` — e.g.
  `settings/terminal` → "Settings", `servers/diff` → "Servers". Centralize via the
  `useThemedHeader` helper so every stack gets a sensible back title from its parent tab's label
  (e.g. derive from `TAB_ROUTES`) rather than hand-writing each one.
- Sweep every `_layout.tsx` for the same gap (this is repo-wide, per the report).
- Consider `headerBackButtonDisplayMode='minimal'` (iOS) as a fallback for screens where no good
  label exists — chevron only, no stray "index".

---

## Problem 5 — tab-switch lag on stylized themes; evaluate replacing the GPU stack

This is the big one and the least certain. **The first job is to measure, not to swap libraries.**

### Symptom
On a friend's (Android) device, switching bottom tabs lags badly on **many non-native themes**.
Native is smooth. That correlation is the tell: **native is the one theme that draws no GPU
chrome** — `ThemedBackground` early-returns `null` when `skin.blobs.length === 0 && !skin.scanlines`
(`ThemedBackground.tsx:26`), and native has no `glowColor` so `Button` draws no animated glow.

### Suspects (both are Skia-backed)
1. **`ThemedBackground` Skia canvas, mounted behind every `ThemedScreen`.** Every tab switch
   mounts/unmounts a fresh Skia `<Canvas>` per screen. **Aurora** is worst: `animateBlobs` drives
   a `useClock()` + `useDerivedValue` repaint *every frame, continuously* (`ThemedBackground.tsx:77–102`),
   so a Skia canvas is repainting forever in the background. **Phosphor** runs an SkSL scanline
   shader (also in `CustomTabBar` when JS tab bar is active).
2. **`react-native-animated-glow`** on primary buttons (`Button.tsx`) — another Skia-based,
   continuously-animating layer on themes with `glowColor` (aurora/phosphor/graphite).

### Step 0 — diagnose before deciding (required)
- Profile a tab switch per theme on a real mid-range Android (Perfetto / RN perf monitor / Flipper).
  Attribute the cost: Skia canvas mount, continuous blob animation, animated-glow, or uniwind
  theme re-render. Confirm it isn't a non-GPU cause (e.g. re-mounting heavy trees on tab change).
- Cheap A/B to localize: temporarily force `ThemedBackground` to `null` and/or swap `AnimatedGlow`
  for the static `boxShadow` fallback (the code already has it, `Button.tsx:94`) and re-measure.

### Step 1 — consider the cheap fix first (possibly no new dependency)
`ThemedBackground`'s own doc comment says the gradient renderer is swappable: *"swap Skia here for
expo-linear-gradient/svg without touching any screen."* If the cost is the Skia canvas + continuous
animation, the lowest-risk fix may be to **stop animating and stop using a GPU canvas for static
chrome**:
- Render blobs as static `expo-linear-gradient` / RN radial gradient (or a pre-baked image) — no
  per-frame repaint, no Skia canvas per screen.
- Drop continuous blob animation (or pause it when the screen isn't focused — `useIsFocused`).
- Replace `react-native-animated-glow` with the static `boxShadow` glow already wired up.

If that recovers the framerate, **we may not need a new GPU library at all** — that's the baseline
every fancier option below must beat. This option should be on the table as the recommendation.

### Step 2 — if we still want rich animated effects, evaluate the WebGPU options
The user named three candidates. **They are not three competing equals — they're a stack**, which
matters for the evaluation:

| Candidate | What it is | Layer | Notes |
|---|---|---|---|
| **`react-native-wgpu`** (`react-native-webgpu`, wcandillon, Dawn-based) | Low-level WebGPU runtime for RN | foundation | The other two depend on it. Raw WebGPU — most control, most code. A `react-native-wgpu` shim re-exports `react-native-webgpu`. |
| **TypeGPU** (Software Mansion) | Type-safe WebGPU toolkit; write WGSL-ish shaders in TypeScript; `@typegpu/react` hooks (`useFrame`, `useRoot`, `useUniform`) | authoring layer **on top of** react-native-wgpu | Great DX/type-safety, but still "build your own effect." Not a drop-in. |
| **`react-native-effects`** (blazejkustra) | WebGPU-powered **drop-in** effect components; render loop runs **off the main thread** on a `react-native-worklets` runtime | high-level, built on WebGPU | Ships ready effects incl. **`Aurora`, `LinearGradient`, `CircularGradient`**, `Silk`, `Iridescence`; `ShaderView` takes a raw WGSL fragment shader for custom effects. |

**Why `react-native-effects` looks most promising for us (to be validated):**
- **Off-thread render loop** is exactly the property that should fix tab-switch lag — the GPU
  animation stops competing with the JS/main thread doing the navigation transition. This is the
  specific advantage Skia-on-the-main-paths doesn't give us today.
- Its built-in `Aurora` + gradient components map almost 1:1 onto what `ThemedBackground` draws by
  hand. `ShaderView` (raw WGSL) covers the phosphor scanline case.
- Highest level → least code to swap in behind the existing single-file `ThemedBackground` seam.

**Trade-offs to weigh during evaluation:**
- New native dependency (WebGPU/Dawn) — bundle size, build complexity (Expo prebuild / config
  plugin), Android GPU/driver variance (this is an Android-perf project — verify on low-end Mali
  devices, cf. [native-terminal-mali-blank-text-debug.md](complete/native-terminal-mali-blank-text-debug.md)).
- Maturity: `react-native-effects` is young/community; `react-native-wgpu` + TypeGPU are SWM-backed
  but WebGPU-on-RN is still new. Skia is the incumbent and battle-tested.
- We'd be running **two** GPU stacks (Skia is still used by the terminal renderer elsewhere) unless
  we fully migrate — quantify the cost of carrying both.
- Does WebGPU init add cold-start cost or its own per-screen mount cost? Must measure, not assume —
  swapping one GPU canvas problem for another would be a regression.

### Step 3 — research task (clone + read, the deliverable the user asked for)
Clone each into `docs/cloned-repos-as-docs/` (per repo convention — read cloned source, not
`node_modules`; see [clone-dep-source-to-docs.md], [effect-ts-build-scripts.md]) and write up a
short comparison:
- `react-native-webgpu` (wcandillon) → `docs/cloned-repos-as-docs/react-native-webgpu`
- `TypeGPU` (software-mansion) → `docs/cloned-repos-as-docs/typegpu`
- `react-native-effects` (blazejkustra) → `docs/cloned-repos-as-docs/react-native-effects`
- (also worth a look: `software-mansion-labs/react-native-shine` — TypeGPU-based shader effects,
  and `react-native-webgpu-worklets` — the off-thread bridge that effects-style libs build on.)

Evaluation criteria: Expo/prebuild integration effort, Android low-end perf (the actual goal),
off-main-thread support, bundle/build cost, API fit behind the `ThemedBackground` seam, maturity/
maintenance, and whether it can also subsume the phosphor scanline shader and the button glow.

**Deliverable of step 3:** a recommendation — most likely one of *(a) cheap static fix, no new
dep*, *(b) react-native-effects*, or *(c) react-native-effects + TypeGPU for the custom scanline
shader* — measured against the Step 1 baseline.

---

## Suggested sequencing

1. **Quick wins, independent, low-risk:** problem 4 (back titles), problem 3 (Android segmented
   wrap). Small, self-contained, shippable immediately.
2. **Native-first UX:** problem 1 (default + appearance override) and problem 2 (native theme
   picker placement) together — they share the native Settings surface and the appearance control.
3. **Perf (gated on measurement):** problem 5 — profile → try the cheap fix → only if needed, run
   the clone-and-evaluate research task and pick a GPU library. This is the largest and riskiest;
   do it last and let data drive it.

## Decisions needed before / during implementation

- Problem 1: ~~separate `appearance` pref vs. expanded theme enum?~~ **Decided: separate pref**
  (implemented). Light variants for stylized themes — still out, for now.
- Problem 2: ~~pushed Appearance sub-screen vs. in-form control?~~ **Decided: pushed sub-screen**
  (implemented), shared with the appearance choice.
- Problem 5 (still open): is the cheap static-gradient fix acceptable visually (do we lose the
  aurora motion we like), or is animated motion a hard requirement that justifies a WebGPU
  dependency? And: step-0 profiling on a real mid-range Android still needs doing — see
  [themes-refactor-gpu-eval.md](themes-refactor-gpu-eval.md) for the measurement plan.

## Addendum (2026-06-12, Android bring-up findings)

- **Problem 5, second cause found:** after the WebGPU migration, tab switches were *still*
  sluggish on the JS bar across ALL themes (even Native, which draws no chrome) while the
  native bar was instant. The GPU chrome was only half the story — `expo-router/js-tabs`
  defaults `detachInactiveScreens` to true on Android, so every switch detached and
  re-attached the hidden tab's native fragment tree. `JsTabsLayout` now passes
  `detachInactiveScreens={false}` (hidden scenes stay attached, `display:none`).
  Details + the WebGPU-canvas persistence work that pairs with it:
  [debug-wgpu-shader-android.md](debug-wgpu-shader-android.md).
- **Native theme, Android tap targets:** `FieldGroup.Section` rows on Android wrap each child
  in a Material `ListItem` (full-height visual surface) but our `onPress` sat on the inner
  `@expo/ui` `Row`, whose natural height is one text line — so only a thin strip was tappable.
  Root cause confirmed from source: `FieldGroup.Section`'s ListItem wrapper is **never**
  `clickable` (`FieldSection.android.tsx`), and there's no escape hatch — `@expo/ui`'s
  *universal* `ListItem` DOES support full-bleed `onPress` (`ListItemView.kt` applies the
  `clickable` modifier to the Material ListItem itself), it's just not what `FieldGroup.Section`
  uses. No upstream issue exists. **Fix:** Android now has its own `native-controls.android.tsx`
  (Metro platform resolution; `native-controls.tsx` stays the iOS/default — SwiftUI `Form`
  already taps full-row) that rebuilds the grouped form from the same Compose primitives
  (`LazyColumn` + `ListItem` + `clip` + `useMaterialColors`, mirroring `FieldGroup`/`FieldSection`)
  but puts `clickable` on each row's `ListItem` → true edge-to-edge ripple + touch target. The
  earlier `defaultMinSize`/`fillMaxWidth` stopgap remains only in the iOS/default file (a no-op
  on iOS). No native module needed — every primitive is JS-exposed by `@expo/ui`.
</content>
</invoke>
