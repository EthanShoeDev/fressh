import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { preferences } from './preferences';
import { JS_TAB_BAR_HEIGHT, NATIVE_TAB_BAR_HEIGHT } from './tab-bar-config';

export function useBottomTabSpacing() {
	const insets = useSafeAreaInsets();
	const [impl] = preferences.tabBarImpl.useValue();
	const tabBarHeight = impl === 'js' ? JS_TAB_BAR_HEIGHT : NATIVE_TAB_BAR_HEIGHT;
	return insets.bottom + tabBarHeight;
}
