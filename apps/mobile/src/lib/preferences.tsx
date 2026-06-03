import {
	createMMKV,
	useMMKVNumber,
	useMMKVString,
} from 'react-native-mmkv';
import type { ThemeName } from './theme';

const storage = createMMKV({ id: 'settings' });

type ShellListViewMode = 'flat' | 'grouped';

/** Terminal font size bounds (logical points), shared by the UI + resolver. */
export const TERMINAL_FONT_SIZE = { min: 8, max: 28, default: 16, step: 1 } as const;

export const preferences = {
	theme: {
		_key: 'theme',
		_resolve: (rawTheme: string | undefined): ThemeName =>
			rawTheme === 'light' ? 'light' : 'dark',
		get: (): ThemeName =>
			preferences.theme._resolve(storage.getString(preferences.theme._key)),
		set: (name: ThemeName) => {
			storage.set(preferences.theme._key, name);
		},
		useThemePref: (): [ThemeName, (name: ThemeName) => void] => {
			const [theme, setTheme] = useMMKVString(preferences.theme._key);
			return [
				preferences.theme._resolve(theme),
				(name: ThemeName) => {
					setTheme(name);
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
			const [mode, setMode] = useMMKVString(preferences.shellListViewMode._key);
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
		_resolve: (raw: number | undefined): number => {
			if (typeof raw !== 'number' || !Number.isFinite(raw)) {
				return TERMINAL_FONT_SIZE.default;
			}
			return Math.min(
				TERMINAL_FONT_SIZE.max,
				Math.max(TERMINAL_FONT_SIZE.min, Math.round(raw)),
			);
		},
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
			const [size, setSize] = useMMKVNumber(preferences.terminalFontSize._key);
			return [
				preferences.terminalFontSize._resolve(size),
				(next: number) => {
					setSize(preferences.terminalFontSize._resolve(next));
				},
			] as const;
		},
	},
} as const;
