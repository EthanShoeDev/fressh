import { QueryClientProvider } from '@tanstack/react-query';
import * as DevClient from 'expo-dev-client';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import React from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { rootLogger } from '@/lib/logger';
import { secretsManager } from '@/lib/secrets-manager';
import { AutoConnectManager } from '../lib/auto-connect';
import { ThemeProvider } from '../lib/theme';
import { queryClient } from '../lib/utils';

rootLogger.info('Fressh App Init', {
	isLiquidGlassAvailable: isLiquidGlassAvailable(),
});

void DevClient.registerDevMenuItems([
	{
		callback: () => {
			rootLogger.info('Hello from dev menu');
		},
		name: 'Hello from dev menu',
	},
]);

export default function RootLayout() {
	React.useEffect(() => {
		void secretsManager.initialize().catch((error: unknown) => {
			rootLogger.warn('Failed to initialize secrets manager', error);
		});
	}, []);

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<AutoConnectManager />
				<KeyboardProvider>
					<Stack screenOptions={{ headerShown: false }} />
				</KeyboardProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
