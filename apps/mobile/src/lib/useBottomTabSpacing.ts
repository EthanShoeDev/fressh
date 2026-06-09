import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { preferences } from './preferences';
import { JS_TAB_BAR_HEIGHT, NATIVE_TAB_BAR_RESERVE } from './tab-bar-config';

export function useBottomTabSpacing() {
	const insets = useSafeAreaInsets();
	const [impl] = preferences.tabBarImpl.useValue();
	// NATIVE_TAB_BAR_RESERVE (not NATIVE_TAB_BAR_TOOLBAR_OFFSET) — the latter's iOS
	// value is a negative toolbar-alignment offset that would reserve no space here.
	const tabBarHeight = impl === 'js' ? JS_TAB_BAR_HEIGHT : NATIVE_TAB_BAR_RESERVE;
	return insets.bottom + tabBarHeight;
}
