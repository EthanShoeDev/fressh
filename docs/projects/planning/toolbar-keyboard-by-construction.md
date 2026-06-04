# Custom key toolbar should sit on the keyboard "by construction"

**Status: PLANNING / DEFERRED (2026-06-03).** Not blocking. The current behaviour works
and is device-verified; this doc captures *why* it needs a measured fudge factor today and
what the clean options are, so we can come back to it. Ethan is not ready to go full-screen
or to regress `NativeTabs` → JS `Tabs` yet, so we park it here.

## The goal

The custom key toolbar (ESC / arrows / CTRL / ALT, in `shell/detail.tsx`) should rest
*exactly* on top of the soft keyboard — flush, no gap, no overlap — **automatically, with no
hand-tuned pixel offset**, and the same way on Android and (eventually) iOS. Right now the
on-screen keyboard overlaps the toolbar a little, and historically we've had to nudge a px
value to line it up.

## Why it's not automatic in *our* stack

The toolbar lives inside the terminal detail screen, which is **nested under
`NativeTabs`** (`apps/mobile/src/app/(tabs)/_layout.tsx`, expo-router *unstable* native
tabs). Two facts combine to force a measured fudge:

1. **The window does not resize for the IME** on this edge-to-edge build. The keyboard is
   reported as an inset (via `react-native-keyboard-controller`), not by shrinking the
   window. So nothing in the layout *automatically* ends at the keyboard top — we compute it.
2. **`NativeTabs` does not expose its tab-bar height to React Native.** The native tab bar it
   draws is outside RN's layout/inset tree. `react-native-safe-area-context`'s `insets.bottom`
   is just the gesture-nav inset — it does **not** include the tab bar. And
   `useBottomTabBarHeight()` exists **only** for the JS `react-navigation` bottom tabs
   (bundled at `expo-router/build/react-navigation/bottom-tabs`), **not** for `NativeTabs`
   (`expo-router/build/native-tabs`, whose only public hook is the iOS-26-only
   `NativeTabs.BottomAccessory.usePlacement`).

The keyboard height is measured from the **screen bottom**, but the toolbar rests above the
**tab bar**. The difference between those two is exactly the tab-bar height — which JS can't
read under `NativeTabs`. So `detail.tsx` falls back to `measureInWindow` on the column to
recover "space reserved below the column" (`bottomReserved`) and does
`marginBottom = max(keyboardHeight − bottomReserved, insets.bottom)`. **That measured
`bottomReserved` is the fudge factor**, and its timing/accuracy is why the alignment drifts.

## How other apps do it (research)

- **Open-source terminal/SSH apps go full-screen.** termux (`docs/cloned-repos-as-docs/termux-app`),
  ConnectBot (Android), Blink Shell (iOS) — none has a bottom tab bar under the terminal. With
  no tab bar, keyboard + toolbar + content share one coordinate space and alignment is exact
  with zero measurement. There is no open-source *React Native* SSH app with a persistent
  bottom tab bar that nails this — terminal apps just don't keep tabs under the terminal.
- **Closed-source apps with tab bars (Termius, etc.) lean on OS keyboard-accessory primitives**,
  where the OS computes every inset so the app never measures pixels:
  - iOS: `inputAccessoryView` — a bar *attached to the keyboard*; the OS pins it on the
    keyboard regardless of any tab bar. (RN: `InputAccessoryView`.)
  - Android: `windowSoftInputMode=adjustResize` — the OS resizes content to end at the
    keyboard top; the framework already knows the tab-bar height.

## GitHub findings (via `gh`)

### THE tracking issue: read the native tab-bar height from JS

**[software-mansion/react-native-screens#3627](https://github.com/software-mansion/react-native-screens/issues/3627)
— "Exposing native bottom tab bar height / 'interface' bottom inset from TabsHost to JS"
(OPEN, filed 2026-02-07).** This is the issue Ethan remembered. It lives in
**`react-native-screens`** (the native backend behind expo-router's `NativeTabs`), which is why
an expo-only search misses it. Verbatim asks of it:

- `react-native-screens` "currently doesn't expose this value" (per maintainer @satya164), so
  `useBottomTabBarHeight()` for native bottom tabs **throws or returns `0`** — there's no real
  native height behind it. (Companion: react-navigation#12958.)
- Request: expose the tab-bar height / "interface" bottom inset from `TabsHost` to JS via any
  stable shape (an `onTabBarHeightChange` event, a host prop, a hook/context, etc.).
- **Status: open, no maintainer fix.** Comments are "+1 / waiting / blocking." The only
  Android workaround offered is a **magic number** (≈48dp landscape / 56dp portrait phone /
  64dp tablet) — exactly the brittle px-tuning we're trying to avoid.

So the precise primitive we want **does not exist on Android yet**. Track #3627.

### What *is* available in our installed versions (expo-router 56.2.8 / react-native-screens 4.25.2)

- **iOS — largely solved already.** [expo/expo#42770](https://github.com/expo/expo/pull/42770)
  (MERGED) wraps native-tab content in a `SafeAreaProvider` on iOS (confirmed: our
  `node_modules/expo-router/build/native-tabs/NativeTabsView.ios.js` does the wrap). Result:
  on iOS **`useSafeAreaInsets().bottom` already includes the native tab-bar height** — by
  construction, no measurement. (Caveat: [rns#3573](https://github.com/software-mansion/react-native-screens/issues/3573),
  open — pre-rendered/not-yet-visited tabs can briefly report device-only insets.)
- **Android — experimental only.** `react-native-screens/experimental` exports a `SafeAreaView`
  (`components/safe-area`, present in 4.25.2) that consumes the BottomNavigationView "interface"
  insets — the same value #3627 wants surfaced. It's flagged *"EXPERIMENTAL, may break without
  notice."* expo also auto-applies bottom content insets to ScrollViews nested in native tabs
  ([#41295](https://github.com/expo/expo/pull/41295), merged) — but our toolbar isn't a
  ScrollView.
- **`tabBarRespectsIMEInsets`** — [expo/expo#45679](https://github.com/expo/expo/pull/45679),
  MERGED, a `NativeTabs` Android prop in our version. Docs: *"When `true`, the tab bar lifts
  above the keyboard (IME) instead of being overlaid by it… Requires `adjustResize`. No effect
  below Android 11. default `false`."* Improves the native-tab ↔ keyboard dance, but it lifts
  the **tab bar**, not our toolbar, and still doesn't hand JS the height — not the fix alone
  (see Option D).
- Related open context issues: [expo#46184](https://github.com/expo/expo/issues/46184),
  [expo#40775](https://github.com/expo/expo/issues/40775),
  [expo#46284](https://github.com/expo/expo/issues/46284).

**Takeaway:** on **iOS** the by-construction value already exists (`useSafeAreaInsets().bottom`);
on **Android** the stable primitive is still missing (blocked on rns#3627), with only the
experimental `SafeAreaView` or a magic number available today.

## Options (for when we revisit)

- **A. Switch `NativeTabs` → JS `Tabs`** (expo-router's bundled react-navigation bottom tabs).
  Then `useBottomTabBarHeight()` gives the tab-bar height *by construction* → exact toolbar
  offset, cross-platform, no `measureInWindow`. **Cost:** loses the truly-native tab bar
  (native blur/liquid-glass on iOS, native Material tabs on Android). Ethan considers this a
  regression — **rejected for now.**
- **B. Full-screen terminal** (move the detail route out of the tabs group). Keyboard +
  toolbar + terminal share the screen-bottom coordinate → exact, zero measurement, identical
  iOS/Android; matches termux/ConnectBot/Blink. **Cost:** no tab bar while in a shell. Ethan
  is **not ready** to go full-screen yet.
- **C. iOS `InputAccessoryView`** for the toolbar (pinned to the keyboard by the OS).
  Most-native iOS feel. **Cost:** Android still needs another strategy → two code paths.
- **D. Stay on `NativeTabs`, lean on the native inset (the most promising no-regression path).**
  - **iOS:** likely already by-construction — read `useSafeAreaInsets().bottom` (it includes
    the tab bar via expo#42770) instead of `measureInWindow`. Worth wiring up + verifying now.
  - **Android:** no stable primitive yet (blocked on **rns#3627**). Options: try the
    experimental `react-native-screens/experimental` `SafeAreaView` to get the "interface"
    bottom inset measurement-free (accepting the experimental risk), or experiment with
    `tabBarRespectsIMEInsets` + `adjustResize`, or keep the `measureInWindow` fudge until #3627
    lands a real hook. Needs a device spike.

## Where the code is today

- `apps/mobile/src/app/(tabs)/shell/detail.tsx` — `keyboardHeight` state from
  `KeyboardEvents.addListener('keyboardDidShow'/'keyboardDidHide')`; `measureColumn` /
  `bottomReserved` (the fudge); `toolbarMarginBottom = max(keyboardHeight − bottomReserved,
  insets.bottom)` applied as the toolbar wrapper's `marginBottom`.
- `apps/mobile/src/app/(tabs)/_layout.tsx` — the `NativeTabs` layout.
- Related, already-resolved work (this margin is *also* what deterministically resizes the
  terminal grid): `docs/projects/complete/renderer-mismatched-selection-cutoff-scrollback.md`.
  Any change here must preserve that the toolbar's layout change still shrinks the `flex:1`
  terminal so the grid/surface stay in lockstep.

## Decision

**Defer.** Keep the current measured approach (works, device-verified). The clean Android
primitive we actually want is still missing upstream — **track
[rns#3627](https://github.com/software-mansion/react-native-screens/issues/3627)** and revisit
when it lands. Sooner wins worth a spike when we return:

1. **iOS:** swap `measureInWindow` → `useSafeAreaInsets().bottom` (already tab-bar-inclusive via
   expo#42770) — probably makes iOS exact by construction with a one-line change.
2. **Android:** spike Option D (experimental `SafeAreaView` and/or `tabBarRespectsIMEInsets`),
   or accept full-screen-while-in-a-shell (Option B, cleanest overall).
