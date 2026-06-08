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
 * Content height (excluding the bottom safe-area inset) of the OS native tab bar
 * (`expo-router/unstable-native-tabs`). The native bar doesn't expose its height
 * to JS (rns#3627), so we use the platform's standard bar height — the same value
 * `useBottomTabSpacing` reserves for scroll padding, and what the terminal
 * keyboard-toolbar offset subtracts so the toolbar clears the IME with the native
 * bar (see docs/projects/complete/toolbar-keyboard-by-construction.md).
 */
export const NATIVE_TAB_BAR_HEIGHT = Platform.select({
	ios: 49,
	android: 80,
	default: 56,
});
