/**
 * The single source of truth for the app's selectable themes — the id, label and
 * preview swatch for each.
 *
 * This module is deliberately dependency-free (no react-native / uniwind / effect
 * imports) so it can be consumed by BOTH the RN app (theme.tsx, preferences.tsx,
 * the Settings pickers) AND the plain-bun tooling (scripts/screenshots.ts,
 * scripts/screenshot-derive.ts). The scripts run under bun with no Metro, so they
 * can't pull in theme.tsx (it drags in react-native + uniwind) — they import the
 * theme list from here instead of re-declaring it, which used to drift.
 *
 * The palettes themselves live in `src/global.css` as `@variant` blocks (registered
 * in `extraThemes` in `metro.config.js`); this array only tracks which are
 * user-facing and how the picker previews them. `AppThemeName` is derived from it,
 * so adding/removing a theme here is the only edit needed.
 */

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
 * Only the four "reimagined" design themes plus Native are selectable — uniwind
 * still defines light/dark internally as its base variants, but the app never
 * selects them.
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
	// "Feels like the OS": real @expo/ui controls (SwiftUI / Material 3) and a
	// neutral system palette that follows the device light/dark. The swatch shows
	// the dark variant; the live theme flips with the system scheme.
	{
		id: 'native',
		label: 'Native',
		swatch: { bg: '#1c1c1e', accent: '#0a84ff', accent2: '#30d158' },
	},
] as const satisfies readonly {
	id: string;
	label: string;
	swatch: ThemeSwatch;
}[];

/** Derived from `APP_THEMES` — the union of selectable theme ids. */
export type AppThemeName = (typeof APP_THEMES)[number]['id'];

/**
 * Just the theme ids, in canonical (capture / picker) order. Handy for runtime
 * validation and for the screenshot capture loop, which keys filenames off the id.
 */
export const APP_THEME_IDS = APP_THEMES.map((t) => t.id) as readonly AppThemeName[];
