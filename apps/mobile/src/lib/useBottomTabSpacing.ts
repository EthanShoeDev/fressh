import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { preferences } from './preferences';
import { JS_TAB_BAR_HEIGHT, NATIVE_TAB_BAR_RESERVE } from './tab-bar-config';
import { skinHasCanvas, useThemeSkin } from './theme-skin';

/**
 * Whether the custom JS tab bar OVERLAYS the scene (absolutely positioned at
 * the bottom) instead of sitting in flow below it. It overlays exactly when
 * the active theme paints a canvas (gradient blobs / scanlines): the scene —
 * and its `ThemedBackground` shader — then runs the full window height, so the
 * canvas continues under the floating bar instead of stopping at a flat strip.
 *
 * Flat themes keep the bar in flow: Monolith's edge-to-edge bar reads as a
 * flush footer, and the Native theme's self-scrolling @expo/ui FieldGroups
 * have no content-inset escape hatch to clear an overlaying bar.
 *
 * `CustomTabBar` (positioning), {@link useBottomTabSpacing} (scroll padding),
 * and the terminal/connect keyboard math all key off this one hook.
 */
export function useJsTabBarOverlay() {
	const [impl] = preferences.tabBarImpl.useValue();
	const skin = useThemeSkin();
	return impl === 'js' && skinHasCanvas(skin);
}

/**
 * Bottom space scroll content must reserve to clear the tab bar:
 * - native bar: it always overlays the scene → bar reserve + safe-area inset.
 * - JS bar, overlay mode (canvas themes): bar height + safe-area inset.
 * - JS bar, in-flow mode (flat themes): 0 — the scene already ends at the
 *   bar's top edge, so there is nothing to clear.
 */
export function useBottomTabSpacing() {
	const insets = useSafeAreaInsets();
	const [impl] = preferences.tabBarImpl.useValue();
	const overlay = useJsTabBarOverlay();
	if (impl === 'native') {
		// NATIVE_TAB_BAR_RESERVE (not NATIVE_TAB_BAR_TOOLBAR_OFFSET) — the latter's
		// iOS value is a negative toolbar-alignment offset that would reserve no
		// space here.
		return insets.bottom + NATIVE_TAB_BAR_RESERVE;
	}
	return overlay ? insets.bottom + JS_TAB_BAR_HEIGHT : 0;
}
