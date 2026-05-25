import { MMKV, useMMKVBoolean, useMMKVString } from 'react-native-mmkv';
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
	updates: {
		lastCheckAt: {
			_key: 'updates.lastCheckAt',
			get: (): string | null =>
				storage.getString(preferences.updates.lastCheckAt._key) ?? null,
			set: (value: string | null) => {
				if (value === null) {
					storage.delete(preferences.updates.lastCheckAt._key);
				} else {
					storage.set(preferences.updates.lastCheckAt._key, value);
				}
			},
			useLastCheckAt: (): [string | null, (value: string | null) => void] => {
				const [value, setValue] = useMMKVString(
					preferences.updates.lastCheckAt._key,
				);
				return [
					value ?? null,
					(next: string | null) => {
						if (next === null) {
							setValue(undefined);
						} else {
							setValue(next);
						}
					},
				] as const;
			},
		},
	},
	agentAlerts: {
		vibration: {
			_key: 'agentAlerts.vibration',
			_resolve: (rawValue: boolean | undefined): boolean => rawValue !== false,
			get: (): boolean =>
				preferences.agentAlerts.vibration._resolve(
					storage.getBoolean(preferences.agentAlerts.vibration._key),
				),
			set: (enabled: boolean) => {
				storage.set(preferences.agentAlerts.vibration._key, enabled);
			},
			useAgentAlertVibrationPref: (): [
				boolean,
				(enabled: boolean) => void,
			] => {
				const [enabled, setEnabled] = useMMKVBoolean(
					preferences.agentAlerts.vibration._key,
				);
				return [
					preferences.agentAlerts.vibration._resolve(enabled),
					(nextEnabled: boolean) => {
						setEnabled(nextEnabled);
					},
				] as const;
			},
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
} as const;
