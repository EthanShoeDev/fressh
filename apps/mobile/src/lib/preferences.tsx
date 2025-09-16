import { MMKV, useMMKVString } from 'react-native-mmkv';
import { type ThemeName } from './theme';

const storage = new MMKV({ id: 'settings' });

type ShellListViewMode = 'flat' | 'grouped';

export const preferences = {
	theme: {
		_key: 'theme',
		_resolve: (rawTheme: string | undefined): ThemeName =>
			rawTheme === 'light' ? 'light' : 'dark',
		get: (): ThemeName =>
			preferences.theme._resolve(storage.getString(preferences.theme._key)),
		set: (name: ThemeName) => storage.set(preferences.theme._key, name),
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
		set: (mode: ShellListViewMode) =>
			storage.set(preferences.shellListViewMode._key, mode),

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
} as const;
