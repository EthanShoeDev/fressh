import { QueryClientProvider } from '@tanstack/react-query';
import * as DevClient from 'expo-dev-client';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import React from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider } from '../lib/theme';
import { queryClient } from '../lib/utils';

console.log('Fressh App Init', {
	isLiquidGlassAvailable: isLiquidGlassAvailable(),
});

void DevClient.registerDevMenuItems([
	{
		callback: () => {
			console.log('Hello from dev menu');
		},
		name: 'Hello from dev menu',
	},
]);

export default function RootLayout() {
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<KeyboardProvider>
					<Stack screenOptions={{ headerShown: false }} />
				</KeyboardProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
