import { useEffect } from 'react';
import {
	Appearance,
	type ColorSchemeName,
	Platform,
	type TextStyle,
	useColorScheme,
} from 'react-native';
import { Uniwind } from 'uniwind';
import { APP_THEMES, type AppThemeName, type ThemeSwatch } from './app-themes';
import { type AppearanceMode, preferences } from './preferences';

/**
 * The selectable themes (id + label + preview swatch) are the single source of
 * truth in `./app-themes` — a dependency-free module so the bun-run screenshot
 * tooling can import the same list instead of re-declaring it. Re-exported here so
 * existing `@/lib/theme` consumers keep their import site.
 */
export { APP_THEMES, type AppThemeName, type ThemeSwatch };

/**
 * Per-theme styling hints for the native bottom tab bar — the levers
 * react-native-bottom-tabs / expo-router NativeTabs expose beyond color
 * (label typography + iOS blur). Color tokens still come from uniwind CSS
 * variables; this only covers what can't live in a `--color-*` token.
 *
 * Each reimagined theme nudges the native bar toward its voice: mono labels for
 * the terminal-flavored ones, a tighter blur for the glassy ones. We can't
 * reproduce a fully stylized bar natively — this gets as close as the native
 * primitives allow.
 */
export type NativeTabStyle = {
	/** iOS UIBlurEffect style applied to the tab bar background. */
	blurEffect?:
		| 'systemChromeMaterial'
		| 'systemMaterial'
		| 'systemUltraThinMaterial'
		| 'systemThinMaterial'
		| 'systemMaterialDark'
		| 'systemChromeMaterialDark';
	/** Font family for tab labels (a monospace system font evokes a terminal). */
	labelFontFamily?: string;
	labelFontWeight?: TextStyle['fontWeight'];
};

/** Built-in monospace face per platform (no extra font assets to bundle). */
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace' });

export const NATIVE_TAB_STYLES: Partial<Record<AppThemeName, NativeTabStyle>> = {
	phosphor: {
		blurEffect: 'systemChromeMaterialDark',
		labelFontFamily: MONO,
		labelFontWeight: '600',
	},
	graphite: {
		blurEffect: 'systemChromeMaterialDark',
		labelFontWeight: '600',
	},
	aurora: {
		blurEffect: 'systemUltraThinMaterial',
		labelFontWeight: '600',
	},
	monolith: {
		blurEffect: 'systemMaterialDark',
		labelFontFamily: MONO,
		labelFontWeight: '700',
	},
};

/**
 * A *resolved* uniwind theme name — every selectable `AppThemeName` plus
 * `native-light`, the system-light variant of Native that the app never stores
 * directly (the picker only ever shows/saves `native`).
 */
type UniwindThemeName = AppThemeName | 'native-light';

/**
 * Fold the device color scheme + the user's appearance override into the stored
 * theme. Only `native` splits by appearance (→ `native`/`native-light`); the
 * four stylized themes are always dark and pass through unchanged. A forced
 * `light`/`dark` appearance wins over the device scheme; `system` follows it.
 */
function resolveUniwindTheme(
	name: AppThemeName,
	scheme: ColorSchemeName | null | undefined,
	appearance: AppearanceMode,
): UniwindThemeName {
	if (name === 'native') {
		const effective = appearance === 'system' ? scheme : appearance;
		return effective === 'light' ? 'native-light' : 'native';
	}
	return name;
}

/**
 * Push a forced appearance into the OS trait environment. Uniwind tokens alone
 * aren't enough for the Native theme: its @expo/ui SwiftUI / Material 3
 * controls color themselves from the system trait collection
 * (`userInterfaceStyle: 'automatic'`), so without this a forced Dark shows a
 * dark RN chrome around a still-light native form. `'unspecified'` returns to
 * the device setting.
 */
function applyAppearanceOverride(appearance: AppearanceMode) {
	Appearance.setColorScheme(
		appearance === 'system' ? 'unspecified' : appearance,
	);
}

/**
 * Apply the persisted theme once at module load (before first render) so the
 * app doesn't flash the default theme then switch. Reads the current system
 * appearance imperatively — and the appearance override pref — so Native lands
 * on the right light/dark variant with no cold-start scheme flash.
 */
export function initAppTheme() {
	const appearance = preferences.appearance.get();
	applyAppearanceOverride(appearance);
	Uniwind.setTheme(
		resolveUniwindTheme(
			preferences.theme.get(),
			Appearance.getColorScheme(),
			appearance,
		),
	);
}

/**
 * Read + change the active app theme and its appearance override. Persists to
 * MMKV and drives uniwind's className re-render via `Uniwind.setTheme`
 * (resolving Native against the current system appearance so the switch is
 * immediate, no flash).
 */
export function useAppTheme() {
	const [themeName, setPref] = preferences.theme.useValue();
	const [appearance, setAppearancePref] = preferences.appearance.useValue();
	const [, setTabBarImpl] = preferences.tabBarImpl.useValue();
	const scheme = useColorScheme();
	const setThemeName = (name: AppThemeName) => {
		setPref(name);
		// Switching to the native theme should bring the native tab bar with it;
		// the stylized JS bar doesn't fit the platform-native look.
		if (name === 'native') setTabBarImpl('native');
		Uniwind.setTheme(resolveUniwindTheme(name, scheme, appearance));
	};
	const setAppearance = (mode: AppearanceMode) => {
		setAppearancePref(mode);
		applyAppearanceOverride(mode);
		Uniwind.setTheme(resolveUniwindTheme(themeName, scheme, mode));
	};
	return { themeName, setThemeName, appearance, setAppearance };
}

/**
 * Keep the live uniwind theme in sync with the system light/dark setting while
 * Native is selected (and following the system). Mount once near the app root.
 * For the stylized themes this is a no-op (they pass through), so it's safe to
 * always run. Idempotent with {@link useAppTheme}'s direct set — both resolve
 * to the same variant.
 */
export function useSystemThemeSync() {
	const [themeName] = preferences.theme.useValue();
	const [appearance] = preferences.appearance.useValue();
	const scheme = useColorScheme();
	useEffect(() => {
		Uniwind.setTheme(resolveUniwindTheme(themeName, scheme, appearance));
	}, [themeName, scheme, appearance]);
}
