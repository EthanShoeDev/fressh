import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { preferences } from './preferences';
import { JS_TAB_BAR_HEIGHT } from './tab-bar-config';

export function useBottomTabSpacing() {
	const insets = useSafeAreaInsets();
	const [impl] = preferences.tabBarImpl.useValue();
	const tabBarHeight =
		impl === 'js'
			? JS_TAB_BAR_HEIGHT
			: Platform.select({
					ios: 49,
					android: 80,
					default: 56,
				});
	return insets.bottom + tabBarHeight;
}
