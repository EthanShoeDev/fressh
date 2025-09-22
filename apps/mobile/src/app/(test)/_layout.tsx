import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useTheme } from '@/lib/theme';
// import { Stack } from 'expo-router';

// export default function Layout() {
// 	return <Stack />;
// }

export default function TabsLayout() {
	const theme = useTheme();

	return (
		<NativeTabs
			// common
			backgroundColor={theme.colors.surface}
			iconColor={theme.colors.muted}
			labelStyle={{ color: theme.colors.muted }}
			tintColor={theme.colors.primary}
			shadowColor={theme.colors.shadow}
			// android
			backBehavior="initialRoute"
			indicatorColor={theme.colors.primary}
			// labelVisibilityMode="labeled"
			// rippleColor={theme.colors.transparent}
			// ios
			// blurEffect="systemChromeMaterial"
			// disableTransparentOnScrollEdge={true}
		>
			<NativeTabs.Trigger name="toolbar-example">
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>
					Toolbar Example
				</Label>
				<Icon
					selectedColor={theme.colors.textPrimary}
					sf="house.fill"
					drawable="ic_menu_myplaces"
				/>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
