import '../global.css';
import * as DevClient from 'expo-dev-client';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { rootLogger } from '@/lib/logger';
import { initAppTheme } from '../lib/theme';

// Apply the persisted app theme before the first render.
initAppTheme();

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
			<KeyboardProvider>
				<Stack screenOptions={{ headerShown: false }} />
			</KeyboardProvider>
		</GestureHandlerRootView>
	);
}
