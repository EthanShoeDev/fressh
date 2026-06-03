import { QueryClientProvider } from '@tanstack/react-query';
import * as DevClient from 'expo-dev-client';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { rootLogger } from '@/lib/logger';
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
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<KeyboardProvider>
						<Stack screenOptions={{ headerShown: false }} />
					</KeyboardProvider>
				</ThemeProvider>
			</QueryClientProvider>
		</GestureHandlerRootView>
	);
}
