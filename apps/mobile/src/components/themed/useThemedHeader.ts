import { useSegments } from 'expo-router';
import { use } from 'react';
import { useCSSVariable } from 'uniwind';
import { TAB_ROUTES } from '@/lib/tab-bar-config';
import { applyCase, useThemeSkin } from '@/lib/theme-skin';
import { CanvasHoistedContext } from './ThemedBackground';

/**
 * Themed options for a native stack header so its title carries the active
 * theme's *typographic* voice (mono face, casing, tracking) — not just color.
 * Native-stack headers ignore `textTransform`, so casing is applied to the
 * title string via the returned `title()` helper.
 *
 * Also sets `headerBackTitle`: every tab root hides the native header (it draws
 * its own inline `ScreenHeader`), so iOS has no previous title to label the back
 * button with and falls back to the raw route name — "index". The parent tab's
 * label (from `TAB_ROUTES`, segments are `['(tabs)', '<tab>', ...]`) is the
 * right name for "where back goes" on every screen in that tab's stack.
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
	// Type as a plain array: with typed routes, `useSegments()` is a union of
	// per-route segment tuples (some length 1, e.g. `['_sitemap']`), so indexing
	// `[1]` on the raw union is a tuple-out-of-bounds type error (TS2493).
	const segments: readonly string[] = useSegments();
	const tab = TAB_ROUTES.find((route) => route.name === segments[1]);
	// When the theme canvas is hoisted above the tab navigator, every native-stack
	// screen must be transparent too — the navigator's default contentStyle paints
	// the opaque navigation-theme background, which would occlude the canvas.
	// Screens that want an opaque background (terminal, settings sub-screens)
	// paint their own.
	const hoistedCanvas = use(CanvasHoistedContext);

	return {
		screenOptions: {
			contentStyle: hoistedCanvas
				? { backgroundColor: 'transparent' as const }
				: undefined,
			headerStyle: { backgroundColor: surface },
			headerTintColor: textPrimary,
			headerTitleStyle: {
				color: textPrimary,
				fontFamily: skin.mono ? skin.monoFamily : undefined,
				fontWeight: skin.mono ? ('700' as const) : undefined,
				letterSpacing: skin.tracking || undefined,
			},
			headerBackTitle: tab ? applyCase(skin, tab.label) : undefined,
			// Outside a known tab there's no good label — show just the chevron
			// rather than a stray route name.
			headerBackButtonDisplayMode: tab
				? ('default' as const)
				: ('minimal' as const),
		},
		/** Apply the theme's casing to a header title string. */
		title: (text: string) => applyCase(skin, text),
	};
}
