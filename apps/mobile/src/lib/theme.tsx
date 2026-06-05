import { Platform, type TextStyle } from 'react-native';
import { Uniwind } from 'uniwind';
import { preferences } from './preferences';

/**
 * A tiny preview palette for each theme, used by the Settings theme picker.
 * `bg` is the canvas, `accent` the primary tint, `accent2` a secondary accent.
 */
export type ThemeSwatch = {
	bg: string;
	accent: string;
	accent2: string;
};

/**
 * The single source of truth for the app's selectable themes. The palettes
 * themselves live in `src/global.css` as `@variant` blocks (registered in
 * `extraThemes` in `metro.config.js`); this array tracks which are user-facing.
 *
 * Only the four "reimagined" design themes are selectable — uniwind still
 * defines light/dark internally as its base variants, but the app never selects
 * them. `AppThemeName` is derived from this array, so adding/removing a theme
 * here is the only edit needed.
 */
export const APP_THEMES = [
	{
		id: 'phosphor',
		label: 'Phosphor',
		swatch: { bg: '#120f0a', accent: '#ffb454', accent2: '#79e08a' },
	},
	{
		id: 'graphite',
		label: 'Graphite',
		swatch: { bg: '#14161b', accent: '#818cf8', accent2: '#a78bfa' },
	},
	{
		id: 'aurora',
		label: 'Aurora',
		swatch: { bg: '#06070d', accent: '#2de6c6', accent2: '#a487ff' },
	},
	{
		id: 'monolith',
		label: 'Monolith',
		swatch: { bg: '#0a0a0a', accent: '#ccff00', accent2: '#f4f4f2' },
	},
] as const satisfies readonly {
	id: string;
	label: string;
	swatch: ThemeSwatch;
}[];

/** Derived from `APP_THEMES` — the union of selectable theme ids. */
export type AppThemeName = (typeof APP_THEMES)[number]['id'];

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
 * Apply the persisted theme once at module load (before first render) so the
 * app doesn't flash the default theme then switch.
 */
export function initAppTheme() {
	Uniwind.setTheme(preferences.theme.get());
}

/**
 * Read + change the active app theme. Persists to MMKV and drives uniwind's
 * className re-render via `Uniwind.setTheme`.
 */
export function useAppTheme() {
	const [themeName, setPref] = preferences.theme.useValue();
	const setThemeName = (name: AppThemeName) => {
		setPref(name);
		Uniwind.setTheme(name);
	};
	return { themeName, setThemeName };
}
