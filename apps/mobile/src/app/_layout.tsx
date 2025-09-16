import { QueryClientProvider } from '@tanstack/react-query';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import React from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider } from '../lib/theme';
import { queryClient } from '../lib/utils';

console.log('Fressh App Init', {
	isLiquidGlassAvailable: isLiquidGlassAvailable(),
});

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
