import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import React from 'react';

export default function TabsLayout() {
	return (
		<NativeTabs>
			<NativeTabs.Trigger name="index">
				<Label>Host</Label>
				<Icon sf="house.fill" drawable="custom_android_drawable" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="shell">
				<Icon sf="gear" drawable="custom_settings_drawable" />
				<Label>Shell</Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings">
				<Icon sf="gear" drawable="custom_settings_drawable" />
				<Label>Settings</Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
