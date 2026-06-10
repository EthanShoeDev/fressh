import { useCSSVariable } from 'uniwind';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';

/**
 * Themed options for a native stack header so its title carries the active
 * theme's *typographic* voice (mono face, casing, tracking) — not just color.
 * Native-stack headers ignore `textTransform`, so casing is applied to the
 * title string via the returned `title()` helper.
 *
 * Usage:
 *   const header = useThemedHeader();
 *   <Stack screenOptions={header.screenOptions}>
 *     <Stack.Screen name='index' options={{ title: header.title('Keys') }} />
 */
export function useThemedHeader() {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const textPrimary = useCSSVariable('--color-text-primary') as string;

	return {
		screenOptions: {
			headerStyle: { backgroundColor: surface },
			headerTintColor: textPrimary,
			headerTitleStyle: {
				color: textPrimary,
				fontFamily: skin.mono ? skin.monoFamily : undefined,
				fontWeight: skin.mono ? ('700' as const) : undefined,
				letterSpacing: skin.tracking || undefined,
			},
		},
		/** Apply the theme's casing to a header title string. */
		title: (text: string) => applyCase(skin, text),
	};
}
