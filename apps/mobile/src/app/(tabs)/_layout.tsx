import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useTheme } from '@/lib/theme';

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
			labelVisibilityMode="labeled"
			// rippleColor={theme.colors.transparent}
			// ios
			blurEffect="systemDefault"
		>
			<NativeTabs.Trigger name="index">
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>Hosts</Label>
				<Icon
					selectedColor={theme.colors.textPrimary}
					sf="house.fill"
					drawable="ic_menu_myplaces"
				/>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="shell">
				<Icon
					selectedColor={theme.colors.textPrimary}
					sf="gear"
					drawable="ic_menu_compass"
				/>
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>
					Shells
				</Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings">
				<Icon
					selectedColor={theme.colors.textPrimary}
					sf="gear"
					drawable="ic_menu_preferences"
				/>
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>
					Settings
				</Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
