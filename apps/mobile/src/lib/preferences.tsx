import { useMemo } from 'react';
import {
	createMMKV,
	useMMKVBoolean,
	useMMKVNumber,
	useMMKVString,
} from 'react-native-mmkv';
import { DEFAULT_TAB_BAR_IMPL, type TabBarImpl } from './tab-bar-config';
import type { AppThemeName } from './theme';

// THE one store for all app preferences. It is bound exactly once — here — and
// handed to every accessor via `definePref` below. Nothing else in the app should
// call `createMMKV` for settings or reach for MMKV directly.
//
// (Why no `{ id: 'settings' }`: the `useMMKV*` hooks, when called without an explicit
// instance, use MMKV's *default* instance. A named instance here meant the imperative
// `get`/`set` read a different store than the hooks wrote — so the persisted theme was
// invisible at startup. Sharing one instance everywhere removes that whole class of
// bug; see `definePref`.)
const storage = createMMKV();

const APP_THEME_NAMES = [
	'phosphor',
	'graphite',
	'aurora',
	'monolith',
	'native',
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

/** Cursor blink modes. Ids must match the Rust `CursorBlink::from_wire` mapping.
 * `Never`/`Always` force the behaviour; `Off`/`On` defer to the program (differing
 * only in the default blink seeded at shell creation). */
export const CURSOR_BLINKS = [
	{ id: 'never', label: 'Never' },
	{ id: 'off', label: 'Off' },
	{ id: 'on', label: 'On' },
	{ id: 'always', label: 'Always' },
] as const;
export type CursorBlinkId = (typeof CURSOR_BLINKS)[number]['id'];

/** Cursor blink interval bounds (ms), matching alacritty's `blink_interval`. */
export const TERMINAL_BLINK_INTERVAL = {
	min: 100,
	max: 2000,
	default: 750,
	step: 50,
} as const;

/** Cursor blink timeout bounds (seconds), matching alacritty's `blink_timeout`.
 * Blinking stops after this many seconds without input (the cursor stays solid)
 * and resumes on a keystroke. `0` disables the timeout — the cursor blinks
 * forever. */
export const TERMINAL_BLINK_TIMEOUT = {
	min: 0,
	max: 60,
	default: 5,
	step: 1,
} as const;

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

type PrefKind = 'string' | 'number' | 'boolean';

type RawOf<K extends PrefKind> = K extends 'string'
	? string
	: K extends 'number'
		? number
		: boolean;

interface Pref<T> {
	/** The MMKV key (handy for debugging / future migrations). */
	readonly key: string;
	/** Imperative, validated read. Safe outside React (e.g. at shell creation). */
	get(): T;
	/** Imperative, validated write. */
	set(value: T): void;
	/**
	 * Reactive read + write; the component re-renders when the value changes.
	 *
	 * Named `useValue` (not `use`) on purpose: the React Compiler (enabled via
	 * `reactCompiler` in app.config.ts) decides what is a Hook by the callee name
	 * matching `/^use[A-Z0-9]/`. A bare `.use()` method is NOT recognized as a Hook,
	 * so the compiler hoists/memoizes it into a conditional block — which turns the
	 * internal `useMMKV*` into a conditional Hook and crashes with "order of Hooks
	 * changed". `useValue` matches the pattern, so it is always treated as a Hook.
	 */
	useValue(): readonly [T, (value: T) => void];
}

/**
 * Define a single preference backed by the shared `storage`. This is the ONLY place
 * that wires a key to MMKV, so a pref's imperative (`get`/`set`) and reactive
 * (`useValue`) paths provably share the same store, key, and `resolve` — they cannot drift apart
 * (the divergence that previously hid the persisted theme).
 *
 * Add a preference by adding one entry to `preferences` below; declare its `key`,
 * `kind`, and a `resolve` that validates the raw value + supplies the default. Never
 * touch `storage` / the `useMMKV*` hooks anywhere else.
 */
function definePref<K extends PrefKind, T extends RawOf<K>>(config: {
	key: string;
	kind: K;
	resolve: (raw: RawOf<K> | undefined) => T;
}): Pref<T> {
	const { key, kind, resolve } = config;

	// Pick the typed getter + hook ONCE, up front (not per-call), so `useValue()`
	// makes a single unconditional hook call and the `storage` instance is always
	// supplied.
	const readRaw =
		kind === 'number'
			? () => storage.getNumber(key) as RawOf<K> | undefined
			: kind === 'boolean'
				? () => storage.getBoolean(key) as RawOf<K> | undefined
				: () => storage.getString(key) as RawOf<K> | undefined;

	const mmkvHook = (
		kind === 'number'
			? useMMKVNumber
			: kind === 'boolean'
				? useMMKVBoolean
				: useMMKVString
	) as (
		key: string,
		instance: typeof storage,
	) => [RawOf<K> | undefined, (value: RawOf<K>) => void];

	return {
		key,
		get: () => resolve(readRaw()),
		set: (value) => {
			storage.set(key, resolve(value));
		},
		useValue: () => {
			const [raw, setRaw] = mmkvHook(key, storage);
			return [
				resolve(raw),
				(value: T) => {
					setRaw(resolve(value));
				},
			] as const;
		},
	};
}

export const preferences = {
	theme: definePref({
		key: 'theme',
		kind: 'string',
		resolve: (raw): AppThemeName =>
			APP_THEME_NAMES.includes(raw as AppThemeName)
				? (raw as AppThemeName)
				: DEFAULT_THEME,
	}),
	tabBarImpl: definePref({
		key: 'tabBarImpl',
		kind: 'string',
		resolve: (raw): TabBarImpl =>
			raw === 'native' || raw === 'js' ? raw : DEFAULT_TAB_BAR_IMPL,
	}),
	shellListViewMode: definePref({
		key: 'shellListViewMode',
		kind: 'string',
		resolve: (raw): ShellListViewMode => (raw === 'grouped' ? 'grouped' : 'flat'),
	}),
	terminalFontSize: definePref({
		key: 'terminalFontSize',
		kind: 'number',
		resolve: (raw) => resolveBoundedNumber(raw, TERMINAL_FONT_SIZE),
	}),
	terminalPadding: definePref({
		key: 'terminalPadding',
		kind: 'number',
		resolve: (raw) => resolveBoundedNumber(raw, TERMINAL_PADDING),
	}),
	terminalScrollback: definePref({
		key: 'terminalScrollback',
		kind: 'number',
		resolve: (raw) => resolveBoundedNumber(raw, TERMINAL_SCROLLBACK),
	}),
	terminalColorScheme: definePref({
		key: 'terminalColorScheme',
		kind: 'string',
		resolve: (raw): ColorSchemeId =>
			COLOR_SCHEMES.some((scheme) => scheme.id === raw)
				? (raw as ColorSchemeId)
				: 'default',
	}),
	terminalCursorStyle: definePref({
		key: 'terminalCursorStyle',
		kind: 'string',
		resolve: (raw): CursorStyleId =>
			CURSOR_STYLES.some((style) => style.id === raw)
				? (raw as CursorStyleId)
				: 'block',
	}),
	terminalCursorBlink: definePref({
		key: 'terminalCursorBlink',
		kind: 'string',
		resolve: (raw): CursorBlinkId =>
			CURSOR_BLINKS.some((blink) => blink.id === raw)
				? (raw as CursorBlinkId)
				: 'off',
	}),
	terminalBlinkInterval: definePref({
		key: 'terminalBlinkInterval',
		kind: 'number',
		resolve: (raw) => resolveBoundedNumber(raw, TERMINAL_BLINK_INTERVAL),
	}),
	terminalBlinkTimeout: definePref({
		key: 'terminalBlinkTimeout',
		kind: 'number',
		resolve: (raw) => resolveBoundedNumber(raw, TERMINAL_BLINK_TIMEOUT),
	}),
	terminalBoldIsBright: definePref({
		key: 'terminalBoldIsBright',
		kind: 'boolean',
		resolve: (raw) => raw ?? true,
	}),
	// App-wide kill-switch for shell integration (OSC 633 auto-injection). When
	// off, fressh injects nothing on connect and behaves like a plain SSH client,
	// regardless of any per-host toggle. Default on. The per-host choice (stored in
	// connection metadata) is ANDed with this at connect time. See
	// docs/projects/terminal-semantic-events.md.
	shellIntegrationEnabled: definePref({
		key: 'shellIntegrationEnabled',
		kind: 'boolean',
		resolve: (raw) => raw ?? true,
	}),
	// Preset commands (one-tap commands) as a JSON array string. The typed
	// accessors + CRUD live in `lib/presets.ts`, which wraps this raw pref —
	// definePref's `resolve` must return a `string`, so the parsing layer sits
	// above it. See docs/projects/future/preset-command-buttons.md.
	presetCommands: definePref({
		key: 'presetCommands',
		kind: 'string',
		resolve: (raw) => raw ?? '[]',
	}),
};

/**
 * Reactive bundle of the render-time terminal config (the live `<Terminal
 * config={...}>` knobs). Scrollback is excluded — it's a control-plane,
 * shell-creation-time concern read via `preferences.terminalScrollback.get()` at
 * `startShell`. Shape matches `TerminalRenderConfig` from the terminal package.
 */
export function useTerminalRenderConfig() {
	const [fontSize] = preferences.terminalFontSize.useValue();
	const [padding] = preferences.terminalPadding.useValue();
	const [colorScheme] = preferences.terminalColorScheme.useValue();
	const [cursorStyle] = preferences.terminalCursorStyle.useValue();
	const [cursorBlink] = preferences.terminalCursorBlink.useValue();
	const [blinkInterval] = preferences.terminalBlinkInterval.useValue();
	const [blinkTimeout] = preferences.terminalBlinkTimeout.useValue();
	const [boldIsBright] = preferences.terminalBoldIsBright.useValue();

	return useMemo(
		() => ({
			fontSize,
			padding,
			colorScheme,
			cursorStyle,
			cursorBlink,
			blinkInterval,
			blinkTimeout,
			boldIsBright,
		}),
		[
			fontSize,
			padding,
			colorScheme,
			cursorStyle,
			cursorBlink,
			blinkInterval,
			blinkTimeout,
			boldIsBright,
		],
	);
}
