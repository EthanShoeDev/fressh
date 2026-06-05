import { useMemo } from 'react';
import {
	createMMKV,
	useMMKVBoolean,
	useMMKVNumber,
	useMMKVString,
} from 'react-native-mmkv';
import {
	DEFAULT_TAB_BAR_IMPL,
	type TabBarImpl,
} from './tab-bar-config';
import type { AppThemeName } from './theme';

// IMPORTANT: this must be the SAME instance the `useMMKV*` hooks use. Those hooks,
// when called without an explicit instance, fall back to MMKV's *default* instance
// (`getDefaultMMKVInstance()`), so the imperative `get`/`set` here must use that same
// default instance — otherwise reads/writes split across two stores. (They did: a
// named `{ id: 'settings' }` instance here vs. the default instance in the hooks meant
// `theme.get()` at startup never saw what the theme picker saved.) We pass `storage`
// explicitly to every hook below so the two paths can never diverge again.
const storage = createMMKV();

const APP_THEME_NAMES = [
	'phosphor',
	'graphite',
	'aurora',
	'monolith',
] as const;

/** Default theme when none is stored (or a stale/removed one was). */
const DEFAULT_THEME: AppThemeName = 'graphite';

type ShellListViewMode = 'flat' | 'grouped';

/** Terminal font size bounds (logical points), shared by the UI + resolver. */
export const TERMINAL_FONT_SIZE = { min: 8, max: 28, default: 16, step: 1 } as const;

/** Terminal inner padding bounds (logical points). */
export const TERMINAL_PADDING = { min: 0, max: 32, default: 0, step: 2 } as const;

/** Scrollback line bounds. Applies to *new* shells (ring buffer is allocated at
 * creation in fressh-core), matching desktop alacritty's restart-to-apply. */
export const TERMINAL_SCROLLBACK = {
	min: 0,
	max: 100_000,
	default: 10_000,
	step: 1_000,
} as const;

/** Preset color schemes. Ids must match the Rust `ColorScheme::by_name` presets. */
export const COLOR_SCHEMES = [
	{ id: 'default', label: 'Default' },
	{ id: 'solarizedDark', label: 'Solarized Dark' },
	{ id: 'solarizedLight', label: 'Solarized Light' },
	{ id: 'dracula', label: 'Dracula' },
	{ id: 'gruvboxDark', label: 'Gruvbox Dark' },
] as const;
export type ColorSchemeId = (typeof COLOR_SCHEMES)[number]['id'];

/** Cursor shapes. Ids must match the Rust `CursorStyle::from_wire` mapping. */
export const CURSOR_STYLES = [
	{ id: 'block', label: 'Block' },
	{ id: 'beam', label: 'Beam' },
	{ id: 'underline', label: 'Underline' },
	{ id: 'hollow', label: 'Hollow' },
] as const;
export type CursorStyleId = (typeof CURSOR_STYLES)[number]['id'];

/** Clamp + round a numeric pref against `{ min, max }` bounds, or fall back. */
function resolveBoundedNumber(
	raw: number | undefined,
	bounds: { min: number; max: number; default: number },
) {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return bounds.default;
	}
	return Math.min(bounds.max, Math.max(bounds.min, Math.round(raw)));
}

export const preferences = {
	theme: {
		_key: 'theme',
		_resolve: (rawTheme: string | undefined): AppThemeName =>
			APP_THEME_NAMES.includes(rawTheme as AppThemeName)
				? (rawTheme as AppThemeName)
				: DEFAULT_THEME,
		get: (): AppThemeName =>
			preferences.theme._resolve(storage.getString(preferences.theme._key)),
		set: (name: AppThemeName) => {
			storage.set(preferences.theme._key, name);
		},
		useThemePref: (): [AppThemeName, (name: AppThemeName) => void] => {
			const [theme, setTheme] = useMMKVString(
				preferences.theme._key,
				storage,
			);
			return [
				preferences.theme._resolve(theme),
				(name: AppThemeName) => {
					setTheme(name);
				},
			] as const;
		},
		/** DEBUG: raw stored value (undefined if MMKV has nothing / isn't ready). */
		peekRaw: (): string | undefined =>
			storage.getString(preferences.theme._key),
	},
	tabBarImpl: {
		_key: 'tabBarImpl',
		_resolve: (raw: string | undefined): TabBarImpl =>
			raw === 'native' || raw === 'js' ? raw : DEFAULT_TAB_BAR_IMPL,
		get: (): TabBarImpl =>
			preferences.tabBarImpl._resolve(
				storage.getString(preferences.tabBarImpl._key),
			),
		set: (impl: TabBarImpl) => {
			storage.set(preferences.tabBarImpl._key, impl);
		},
		useTabBarImplPref: (): [TabBarImpl, (impl: TabBarImpl) => void] => {
			const [impl, setImpl] = useMMKVString(
				preferences.tabBarImpl._key,
				storage,
			);
			return [
				preferences.tabBarImpl._resolve(impl),
				(next: TabBarImpl) => {
					setImpl(next);
				},
			] as const;
		},
	},
	shellListViewMode: {
		_key: 'shellListViewMode',
		_resolve: (rawMode: string | undefined): ShellListViewMode =>
			rawMode === 'grouped' ? 'grouped' : 'flat',
		get: (): ShellListViewMode =>
			preferences.shellListViewMode._resolve(
				storage.getString(preferences.shellListViewMode._key),
			),
		set: (mode: ShellListViewMode) => {
			storage.set(preferences.shellListViewMode._key, mode);
		},

		useShellListViewModePref: (): [
			ShellListViewMode,
			(mode: ShellListViewMode) => void,
		] => {
			const [mode, setMode] = useMMKVString(
				preferences.shellListViewMode._key,
				storage,
			);
			return [
				preferences.shellListViewMode._resolve(mode),
				(mode: 'flat' | 'grouped') => {
					setMode(mode);
				},
			] as const;
		},
	},
	terminalFontSize: {
		_key: 'terminalFontSize',
		_resolve: (raw: number | undefined): number =>
			resolveBoundedNumber(raw, TERMINAL_FONT_SIZE),
		get: (): number =>
			preferences.terminalFontSize._resolve(
				storage.getNumber(preferences.terminalFontSize._key),
			),
		set: (size: number) => {
			storage.set(
				preferences.terminalFontSize._key,
				preferences.terminalFontSize._resolve(size),
			);
		},
		useTerminalFontSizePref: (): [number, (size: number) => void] => {
			const [size, setSize] = useMMKVNumber(
				preferences.terminalFontSize._key,
				storage,
			);
			return [
				preferences.terminalFontSize._resolve(size),
				(next: number) => {
					setSize(preferences.terminalFontSize._resolve(next));
				},
			] as const;
		},
	},
	terminalPadding: {
		_key: 'terminalPadding',
		_resolve: (raw: number | undefined): number =>
			resolveBoundedNumber(raw, TERMINAL_PADDING),
		get: (): number =>
			preferences.terminalPadding._resolve(
				storage.getNumber(preferences.terminalPadding._key),
			),
		set: (padding: number) => {
			storage.set(
				preferences.terminalPadding._key,
				preferences.terminalPadding._resolve(padding),
			);
		},
		useTerminalPaddingPref: (): [number, (padding: number) => void] => {
			const [padding, setPadding] = useMMKVNumber(
				preferences.terminalPadding._key,
				storage,
			);
			return [
				preferences.terminalPadding._resolve(padding),
				(next: number) => {
					setPadding(preferences.terminalPadding._resolve(next));
				},
			] as const;
		},
	},
	terminalScrollback: {
		_key: 'terminalScrollback',
		_resolve: (raw: number | undefined): number =>
			resolveBoundedNumber(raw, TERMINAL_SCROLLBACK),
		get: (): number =>
			preferences.terminalScrollback._resolve(
				storage.getNumber(preferences.terminalScrollback._key),
			),
		set: (lines: number) => {
			storage.set(
				preferences.terminalScrollback._key,
				preferences.terminalScrollback._resolve(lines),
			);
		},
		useTerminalScrollbackPref: (): [number, (lines: number) => void] => {
			const [lines, setLines] = useMMKVNumber(
				preferences.terminalScrollback._key,
				storage,
			);
			return [
				preferences.terminalScrollback._resolve(lines),
				(next: number) => {
					setLines(preferences.terminalScrollback._resolve(next));
				},
			] as const;
		},
	},
	terminalColorScheme: {
		_key: 'terminalColorScheme',
		_resolve: (raw: string | undefined): ColorSchemeId =>
			COLOR_SCHEMES.some((scheme) => scheme.id === raw)
				? (raw as ColorSchemeId)
				: 'default',
		get: (): ColorSchemeId =>
			preferences.terminalColorScheme._resolve(
				storage.getString(preferences.terminalColorScheme._key),
			),
		set: (id: ColorSchemeId) => {
			storage.set(preferences.terminalColorScheme._key, id);
		},
		useTerminalColorSchemePref: (): [
			ColorSchemeId,
			(id: ColorSchemeId) => void,
		] => {
			const [id, setId] = useMMKVString(
				preferences.terminalColorScheme._key,
				storage,
			);
			return [
				preferences.terminalColorScheme._resolve(id),
				(next: ColorSchemeId) => {
					setId(next);
				},
			] as const;
		},
	},
	terminalCursorStyle: {
		_key: 'terminalCursorStyle',
		_resolve: (raw: string | undefined): CursorStyleId =>
			CURSOR_STYLES.some((style) => style.id === raw)
				? (raw as CursorStyleId)
				: 'block',
		get: (): CursorStyleId =>
			preferences.terminalCursorStyle._resolve(
				storage.getString(preferences.terminalCursorStyle._key),
			),
		set: (id: CursorStyleId) => {
			storage.set(preferences.terminalCursorStyle._key, id);
		},
		useTerminalCursorStylePref: (): [
			CursorStyleId,
			(id: CursorStyleId) => void,
		] => {
			const [id, setId] = useMMKVString(
				preferences.terminalCursorStyle._key,
				storage,
			);
			return [
				preferences.terminalCursorStyle._resolve(id),
				(next: CursorStyleId) => {
					setId(next);
				},
			] as const;
		},
	},
	terminalBoldIsBright: {
		_key: 'terminalBoldIsBright',
		_resolve: (raw: boolean | undefined): boolean => raw ?? true,
		get: (): boolean =>
			preferences.terminalBoldIsBright._resolve(
				storage.getBoolean(preferences.terminalBoldIsBright._key),
			),
		set: (enabled: boolean) => {
			storage.set(preferences.terminalBoldIsBright._key, enabled);
		},
		useTerminalBoldIsBrightPref: (): [boolean, (enabled: boolean) => void] => {
			const [enabled, setEnabled] = useMMKVBoolean(
				preferences.terminalBoldIsBright._key,
				storage,
			);
			return [
				preferences.terminalBoldIsBright._resolve(enabled),
				(next: boolean) => {
					setEnabled(next);
				},
			] as const;
		},
	},
} as const;

/**
 * Reactive bundle of the render-time terminal config (the live `<Terminal
 * config={...}>` knobs). Scrollback is excluded — it's a control-plane,
 * shell-creation-time concern read via `preferences.terminalScrollback.get()` at
 * `startShell`. Shape matches `TerminalRenderConfig` from the terminal package.
 */
export function useTerminalRenderConfig() {
	const [fontSize] = preferences.terminalFontSize.useTerminalFontSizePref();
	const [padding] = preferences.terminalPadding.useTerminalPaddingPref();
	const [colorScheme] =
		preferences.terminalColorScheme.useTerminalColorSchemePref();
	const [cursorStyle] =
		preferences.terminalCursorStyle.useTerminalCursorStylePref();
	const [boldIsBright] =
		preferences.terminalBoldIsBright.useTerminalBoldIsBrightPref();

	return useMemo(
		() => ({ fontSize, padding, colorScheme, cursorStyle, boldIsBright }),
		[fontSize, padding, colorScheme, cursorStyle, boldIsBright],
	);
}
