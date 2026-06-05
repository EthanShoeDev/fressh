import '../global.css';
import * as DevClient from 'expo-dev-client';
import { useFonts } from 'expo-font';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Uniwind } from 'uniwind';
import { rootLogger } from '@/lib/logger';
import { appFonts } from '../lib/fonts';
import { preferences } from '../lib/preferences';
import { initAppTheme } from '../lib/theme';

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
	// Apply the persisted theme on the FIRST render — not at module load. expo-router
	// evaluates this module extremely early, before MMKV's JSI binding is reliably
	// installed, so reading the stored theme at module scope falls back to
	// DEFAULT_THEME (graphite) and the user's choice is "lost" until they re-pick it.
	// A lazy useState initializer runs exactly once, synchronously before children
	// render (no theme flash), by which point native modules are ready.
	useState(initAppTheme);

	// DEBUG: compare the stored theme + Uniwind's active theme right after mount and
	// ~1.5s later. If `peekRaw`/`get` differ between the two, MMKV wasn't ready at
	// first render (a timing race). If they agree but `currentTheme` is wrong,
	// `setTheme` isn't sticking.
	useEffect(() => {
		const snap = (tag: string) =>
			rootLogger.info(`[theme-debug ${tag}]`, {
				rawStored: preferences.theme.peekRaw(),
				resolved: preferences.theme.get(),
				currentTheme: Uniwind.currentTheme,
				hasAdaptiveThemes: Uniwind.hasAdaptiveThemes,
			});
		snap('mount');
		const t = setTimeout(() => snap('+1500ms'), 1500);
		return () => clearTimeout(t);
	}, []);

	// Load the design typefaces before first paint (runtime, via expo-font).
	const [fontsLoaded, fontError] = useFonts(appFonts);

	if (!fontsLoaded && !fontError) {
		return null;
	}

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<KeyboardProvider>
				<Stack screenOptions={{ headerShown: false }} />
			</KeyboardProvider>
		</GestureHandlerRootView>
	);
}
