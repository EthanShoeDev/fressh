import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useBottomTabSpacing() {
	const insets = useSafeAreaInsets();
	const estimatedTabBarHeight = Platform.select({
		ios: 49,
		android: 80,
		default: 56,
	});
	return insets.bottom + estimatedTabBarHeight;
}
