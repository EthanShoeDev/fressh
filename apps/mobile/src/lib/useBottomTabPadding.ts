import React from 'react';
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type LayoutEvent = {
	nativeEvent: {
		layout: {
			y: number;
			height: number;
		};
	};
};

export function useBottomTabPadding(basePadding = 12) {
	const insets = useSafeAreaInsets();
	const windowH = Dimensions.get('window').height;
	const estimatedTabBarHeight = Platform.select({
		ios: 49,
		android: 80,
		default: 56,
	});
	const [bottomExtra, setBottomExtra] = React.useState(0);

	const onLayout = React.useCallback(
		(e: LayoutEvent) => {
			const { y, height } = e.nativeEvent.layout;
			const extra = windowH - (y + height);
			setBottomExtra(extra > 0 ? extra : 0);
		},
		[windowH],
	);

	const paddingBottom =
		basePadding + insets.bottom + (bottomExtra || estimatedTabBarHeight!);
	return { paddingBottom, onLayout } as const;
}
