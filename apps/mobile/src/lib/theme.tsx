import { Uniwind } from 'uniwind';
import { preferences } from './preferences';

/**
 * App color themes. The palettes themselves live in `src/global.css` as
 * `@variant` blocks; this module only tracks the selectable names and bridges
 * the persisted choice into uniwind's runtime theme.
 *
 * `system` follows the device color scheme (adaptive); the others are fixed.
 * `dracula` is registered via `extraThemes` in `metro.config.js`.
 */
export type AppThemeName = 'system' | 'light' | 'dark' | 'dracula';

export const APP_THEMES = [
	{ id: 'system', label: 'System' },
	{ id: 'light', label: 'Light' },
	{ id: 'dark', label: 'Dark' },
	{ id: 'dracula', label: 'Dracula' },
] as const satisfies readonly { id: AppThemeName; label: string }[];

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
	const [themeName, setPref] = preferences.theme.useThemePref();
	const setThemeName = (name: AppThemeName) => {
		setPref(name);
		Uniwind.setTheme(name);
	};
	return { themeName, setThemeName };
}
