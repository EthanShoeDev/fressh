import { QueryClientProvider } from '@tanstack/react-query';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { queryClient } from '../lib/utils';
import { ThemeProvider } from '../theme';

console.log('Fressh App Init', {
	isLiquidGlassAvailable: isLiquidGlassAvailable(),
});

// https://docs.expo.dev/versions/latest/sdk/navigation-bar/

export default function RootLayout() {
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
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
			</ThemeProvider>
		</QueryClientProvider>
	);
}
