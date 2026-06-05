import { JsTabsLayout } from '@/components/navigation/JsTabsLayout';
import { NativeTabsLayout } from '@/components/navigation/NativeTabsLayout';
import { preferences } from '@/lib/preferences';

/**
 * Bottom tab bar selector. Renders either the native bar or our custom JS bar
 * based on the `tabBarImpl` preference (seeded by the `EXPO_PUBLIC_TAB_BAR`
 * build-time default). Flipping it in Settings remounts the navigator — per-tab
 * stack history resets, which is fine for a try-it-out toggle.
 */
export default function TabsLayout() {
	const [impl] = preferences.tabBarImpl.useValue();
	return impl === 'js' ? <JsTabsLayout /> : <NativeTabsLayout />;
}
