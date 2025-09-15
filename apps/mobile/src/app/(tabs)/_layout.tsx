import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
	const theme = useTheme();
	return (
		<NativeTabs backgroundColor={theme.colors.surface}>
			<NativeTabs.Trigger name="index">
				<Label>Host</Label>
				<Icon sf="house.fill" drawable="ic_menu_myplaces" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="shell">
				<Icon sf="gear" drawable="ic_menu_compass" />
				<Label>Shell</Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings">
				<Icon sf="gear" drawable="ic_menu_preferences" />
				<Label>Settings</Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
