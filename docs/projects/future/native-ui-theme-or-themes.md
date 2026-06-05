# Future project: a "Native" theme built from platform UI elements (@expo/ui)

**Status:** NOT STARTED — exploratory. Architecturally distinct from our other themes
(see the key insight below) and depends on adding `@expo/ui`. Tractable in phases.

**Scope (if pursued):** the mobile app's theme system (`apps/mobile/src/lib/theme.tsx`,
`theme-skin.ts`, `global.css`) + the settings-control components, + a new `@expo/ui`
dependency. Renderer/SSH/terminal untouched.

**Reference:** the cloned Expo monorepo at `docs/cloned-repos-as-docs/expo/packages/
expo-ui` — SwiftUI + Jetpack Compose component bindings, greatly expanded in SDK 56.

## Goal

Add a theme whose whole personality is **"look and feel like the operating system."** Our
four existing themes are deliberate, stylized aesthetics (phosphor CRT, graphite
hairline, aurora glass, monolith brutalist). A **Native** theme is the opposite ethos:
use as many real platform UI elements as possible — native toggles, sliders, steppers,
pickers, segmented controls, grouped lists/forms — so the app feels like a first-party
iOS/Android app, honoring the platform's own controls, animations, haptics, and
light/dark. `@expo/ui` (SwiftUI on iOS, Jetpack Compose on Android) is exactly the bridge
for this, and it's now broad enough to cover our UI surface.

## The key insight: this theme works differently from every other theme

Our theming today is **token-and-skin substitution**, *not* component substitution:

- **Colors** come from uniwind `@variant` blocks in `src/global.css` — each theme
  redefines the same `--color-*` tokens; classNames like `bg-surface` re-resolve.
- **Everything non-color** comes from the `ThemeSkin` object (`theme-skin.ts`): `radius`,
  `glow`, `glass`, `scanlines`, fonts, `textCase`, `tracking`, title styling, etc.
- The actual **controls are custom-drawn**: `Segmented`, `StepperRow`, `SelectRow` in the
  settings screens are Pressable + uniwind. Only `ToggleRow` uses a real native control
  (RN's `<Switch>`), and the server-connect form uses
  `@react-native-segmented-control`. So switching theme today never changes *which
  component renders* — only its colors/radius/font.

**A Native theme can't be expressed as tokens + skin.** You cannot recolor a custom
Pressable into a SwiftUI `Toggle` via a CSS variable — a SwiftUI/Compose control is a
*different native view*, self-colored by the platform, living in its own host. So this
theme requires a **new substitution axis: component-level swapping.** That's the real
design work here; the colors are almost an afterthought (the platform colors its own
controls).

## What @expo/ui gives us (SDK 56 inventory)

Three import surfaces in `expo-ui/src`:

- **`@expo/ui` universal** — *one* import, renders SwiftUI on iOS and Compose on Android.
  Covers almost exactly our control set: **`Switch`, `Slider`, `Picker`, `Button`,
  `Checkbox`, `List`, `ListItem`, `Section`/`FieldGroup`, `TextInput`, `Collapsible`,
  `Host`, `Icon`, `Row`/`Column`, `ScrollView`, `BottomSheet`.** This is the natural fit
  for "one Native theme, both platforms."
- **`@expo/ui/swift-ui`** — full SwiftUI set for iOS fidelity: `Form`, `Section`, `List`,
  `Toggle`, `Slider`, `Stepper`, `Picker`, `SegmentedControl` (via `Picker`),
  `ColorPicker`, `DatePicker`, `Gauge`, `Label`, `DisclosureGroup`, `Menu`, `Button`
  (incl. glass), plus iOS-26 glass (`GlassEffectContainer`).
- **`@expo/ui/jetpack-compose`** — full Material 3 set: `Switch`, `Slider`,
  `SegmentedButton`/`SingleChoiceSegmentedButtonRow`, `RadioButton`, `Card`, `Surface`,
  `ListItem`, `Chip`, `Stepper`-equivalents, `NavigationBar`, `Checkbox`, `DropdownMenu`,
  `SearchBar`, etc.

This maps cleanly onto what we have:

| Our custom control     | Native replacement |
| ---------------------- | ------------------ |
| `Segmented` (Pressable) | universal `Picker` (segmented) / SwiftUI `Picker` / Compose `SingleChoiceSegmentedButtonRow` |
| `StepperRow` (−/+)      | SwiftUI `Stepper` / Compose stepper, or `Slider` for ranges (font size, padding) |
| `SelectRow` (checkmark) | universal `Picker` / SwiftUI `List`+selection / Compose `RadioButton` |
| `ToggleRow` (RN Switch) | universal `Switch` / SwiftUI `Toggle` / Compose `Switch` |
| settings cards/sections | SwiftUI `Form`/`Section` / Compose `Surface`+`ListItem` |

## "A theme, or themes?" — the question in the filename

Three framings; pick deliberately:

- **One "System/Native" theme (recommended start).** A single fifth theme that uses the
  **universal** components, so one codebase yields iOS-SwiftUI and Android-Compose looks
  automatically. Cleanest mental model, least code, still feels native on each platform.
- **An orthogonal "native controls" *mode*, not a theme.** Because native-ness is really
  a *component-swap axis* (above), it could be a toggle that layers onto *any* color
  theme — "use native controls" on top of graphite, say. More flexible, but muddies the
  "themes are total aesthetics" model and risks ugly mixes (native iOS Toggle inside a
  CRT-scanline screen). Probably over-engineered for v1.
- **Two platform-tuned themes ("iOS Native" / "Material You").** Lean into per-platform
  fidelity with `swift-ui` / `jetpack-compose` directly (iOS grouped inset `Form`,
  Android Material 3 `Surface`/dynamic color). Maximum nativeness, most divergence from
  the uniwind layout, most work.

Recommendation: ship **one universal "Native" theme** first; only split into
platform-specific themes if users want deeper per-OS fidelity.

## The seam: a theme-aware control layer

The clean way to introduce component-swapping without rewriting screens: make the
**settings-control components theme-aware**, so they branch on the active theme.

- Today `Segmented`, `StepperRow`, `ToggleRow`, `SelectRow` are the choke points every
  settings screen already routes through. Give each a `theme === 'native'` branch that
  renders the `@expo/ui` equivalent instead of the Pressable version.
- Screens (`settings/index.tsx`, `settings/terminal.tsx`, `servers/connect.tsx`) keep
  using `<ToggleRow>` / `<Segmented>` and don't change. The native-ness lives behind the
  control boundary.
- For container chrome (grouped lists/forms), a similar branch in `ThemedScreen` /
  `Surface` / `Section`: render SwiftUI `Form`/`Section` or Compose `Surface`/`ListItem`
  under the Native theme, uniwind cards otherwise.

This keeps the existing themes 100% untouched and isolates all expo-ui usage to a small,
theme-gated control layer.

## Phasing

- **v0 (controls only):** add `@expo/ui`; create the `'native'` theme entry; swap the
  four settings controls (`Toggle`/`Slider`/`Picker`/`Stepper`) to **universal** expo-ui
  inside a theme branch. Neutral system-ish color tokens; let controls self-color. Proves
  the component-swap seam on the highest-value, lowest-layout-risk surface (settings).
- **v1 (native containers):** swap settings *containers* to native grouped `Form`/`List`
  (iOS) / `Surface`+`ListItem` (Android) for true platform layout, not just native
  widgets in our cards.
- **v2 (deeper):** native `NavigationBar`/tab chrome, `BottomSheet`, `ContextMenu`,
  `SearchBar`, light/dark following the system, haptics. Optional per-platform split.

## Risks & open questions

- **`@expo/ui` is new and fast-moving.** We're on `expo ~56.0.3` (locked — see the
  dep-update memory). expo-ui ships frequent releases (the CHANGELOG shows active
  breaking-ish churn through 56.0.x). Pin a known-good version; expect API drift; some
  components are gated to recent OS (iOS-26 glass, Compose `NavigationBar`/Material-3
  expressive). Budget for "the component exists but only on new OS versions."
- **Host/layout friction — the biggest practical risk.** expo-ui components render inside
  native **`Host`** views; they don't participate in RN flexbox the way RN views do. Each
  needs a `Host` wrapper and explicit sizing, and mixing them into uniwind-laid-out
  screens can fight over measurement/intrinsic size. The universal components ease this,
  but it's the thing most likely to make v0 fiddly. Prototype one screen end-to-end
  before committing.
- **Color ownership.** Native controls self-color from the platform (iOS tint, Material
  dynamic color). Decide how much our `--color-primary` should override vs. how much we
  defer to the OS. A Native theme probably *wants* to defer — that's the point — so its
  uniwind tokens should be neutral/system, not branded.
- **Light/dark.** Our themes are dark-leaning; a real Native theme should follow the
  system appearance. Does uniwind support a system-driven light/dark for one theme, or do
  we need a `colorScheme` pass-through to expo-ui `Host`?
- **Consistency with stylized themes — accepted by design, not a risk to solve.** Native
  controls deliberately *won't* mix with the stylized themes (a SwiftUI Toggle has no
  business inside a CRT-scanline or brutalist screen), and that's precisely why Native is
  its own **self-contained theme**, not a "native controls" mode layered onto the others.
  We are not trying to make native-ness composable with phosphor/aurora/monolith — those
  will keep their custom-drawn controls. This is the main argument *against* framing #2
  (the orthogonal mode) above: the incoherence isn't a bug to engineer around, it's the
  reason to keep Native all-in and separate.
- **Fonts/casing.** The skin's `monoFamily`/`textCase`/`tracking` shouldn't apply under
  Native (the platform owns typography in its controls). The `'native'` skin entry should
  be mostly empty / system-default.
- **Two more platforms' worth of testing.** Native means real per-OS QA on device
  (SwiftUI vs Compose behavior diverges) — agent-device runs on Android; iOS needs its
  own pass.

## Why it's worth doing

It directly serves users who want fressh to feel like a polished first-party app rather
than a styled webview-ish UI — native controls bring correct touch targets, momentum,
haptics, accessibility, and OS light/dark for free. It also future-proofs us against the
maintenance cost of hand-rolling controls (`Segmented`, `StepperRow`, `SelectRow` are all
re-implementations of things the OS already ships well). The architectural payoff is the
**component-swap seam**: once controls can branch by theme, we own a clean axis for "OS
look" that the rest of the theme system never had.

## How this relates to the other future docs

Unlike [terminal-semantic-events.md](terminal-semantic-events.md) /
[git-diff-integration.md](git-diff-integration.md) (terminal data plane) and
[on-device-shell.md](on-device-shell.md) / [preview-terminal-theme.md](preview-terminal-theme.md)
(byte-source / renderer), this one is purely **app-shell UI** — it touches the theme
system and settings controls, not the `Term`/SSH/render stack at all. It's the most
self-contained of the future projects and could ship independently.
