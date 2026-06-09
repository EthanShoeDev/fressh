import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform } from 'react-native';

/**
 * Which bottom tab bar implementation the app renders:
 * - `native` — `expo-router/unstable-native-tabs` (liquid-glass / Material). Fast
 *   and platform-correct, but only partially styleable.
 * - `js` — a fully custom React-rendered bar (`CustomTabBar`) that inherits each
 *   theme's skin (glow / scanlines / glass / radius), at the cost of dropping the
 *   native blur material.
 *
 * Both live in the tree; `(tabs)/_layout.tsx` picks one. The choice is a runtime
 * preference (see `preferences.tabBarImpl`) seeded by the build-time default below.
 */
export type TabBarImpl = 'native' | 'js';

/**
 * Build-time default, overridable per build via the `EXPO_PUBLIC_TAB_BAR` env var
 * (Expo inlines `EXPO_PUBLIC_*` at bundle time). Falls back to `js` — the custom,
 * fully theme-styleable bar — for any unset/invalid value. The runtime pref
 * overrides this once the user toggles it in Settings.
 */
export const DEFAULT_TAB_BAR_IMPL: TabBarImpl =
	process.env.EXPO_PUBLIC_TAB_BAR === 'js' ||
	process.env.EXPO_PUBLIC_TAB_BAR === 'native'
		? process.env.EXPO_PUBLIC_TAB_BAR
		: 'js';

/**
 * Single source of truth for the bottom tabs, consumed by BOTH the native and JS
 * layouts so their route names / labels / icons can never drift. `name` must match
 * the route folder under `app/(tabs)/`.
 */
export const TAB_ROUTES = [
	{
		name: 'servers',
		label: 'Servers',
		iconFamily: FontAwesome6,
		icon: 'server',
	},
	{
		name: 'commands',
		label: 'Commands',
		iconFamily: FontAwesome6,
		icon: 'bolt',
	},
	{
		name: 'keys',
		label: 'Keys',
		iconFamily: MaterialCommunityIcons,
		icon: 'key-variant',
	},
	{
		name: 'settings',
		label: 'Settings',
		iconFamily: MaterialCommunityIcons,
		icon: 'cog',
	},
] as const;

export type TabRoute = (typeof TAB_ROUTES)[number];
export type TabRouteName = TabRoute['name'];

/**
 * Content height (excluding the bottom safe-area inset) of the custom JS bar.
 * Shared by `CustomTabBar`'s container and `useBottomTabSpacing` so scroll
 * padding under the bar stays exact.
 */
export const JS_TAB_BAR_HEIGHT = 64;

/**
 * Per-platform offset that lands the terminal keyboard-toolbar on top of the IME
 * when the NATIVE tab bar is active. This is NOT a bar height (despite the Android
 * value looking like one) and NOT scroll padding — it's a correction term consumed
 * only by terminal.tsx's `spaceBelowColumn`. For "how much the bar occludes" (scroll
 * padding) use NATIVE_TAB_BAR_RESERVE below. The native bar doesn't expose its height
 * to JS (rns#3627), so this is a hand-tuned knob: increasing it lowers the toolbar,
 * decreasing it raises it.
 *
 * Why the sign flips between platforms (this confused us — it's real):
 * `softwareKeyboardLayoutMode: 'resize'` is ANDROID-ONLY (app.config.ts). So when the
 * keyboard opens the two platforms are in OPPOSITE layout regimes:
 *  - Android (resize): the OS shrinks the window to end at the keyboard top, so the
 *    column is already lifted above the keyboard. The value adds back the tab-bar
 *    band the resize reclaimed → genuinely POSITIVE (~80).
 *  - iOS (overlay): the window does NOT resize; the column still runs to the physical
 *    screen bottom, behind the keyboard. iOS's keyboard frame already spans down past
 *    the home indicator AND the tab-bar region, so the formula's `+ insets.bottom`
 *    (and the bar's safe-area inset baked into the column bottom) are double-counted.
 *    The value goes NEGATIVE to cancel them: -84 ≈ -(tab bar 49 + home indicator 34).
 *    It's an inset cancellation, not a height — which is exactly why a positive
 *    "bar height" like Android's could never line up on iOS.
 * See docs/projects/complete/toolbar-keyboard-by-construction.md.
 */
export const NATIVE_TAB_BAR_TOOLBAR_OFFSET = Platform.select({
	ios: -84,
	android: 80,
	default: 56,
});

/**
 * Space (excluding the bottom safe-area inset) the native tab bar occupies, used by
 * `useBottomTabSpacing` to pad scroll content so it clears the bar. iOS standard tab
 * bar height is 49pt (the inset is added on top by the hook). Kept SEPARATE from
 * NATIVE_TAB_BAR_TOOLBAR_OFFSET, whose iOS value is a negative toolbar-alignment
 * offset that would otherwise zero out (or invert) this reserve.
 */
export const NATIVE_TAB_BAR_RESERVE = Platform.select({
	ios: 49,
	android: 80,
	default: 56,
});
