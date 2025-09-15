import { QueryClientProvider } from '@tanstack/react-query';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import React from 'react';
import { queryClient } from '../lib/utils';
import { ThemeProvider } from '../theme';

console.log('Fressh App Init', {
	isLiquidGlassAvailable: isLiquidGlassAvailable(),
});

export default function RootLayout() {
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<Stack screenOptions={{ headerShown: false }} />
			</ThemeProvider>
		</QueryClientProvider>
	);
}
