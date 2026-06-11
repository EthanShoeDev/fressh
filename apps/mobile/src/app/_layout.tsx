import '../global.css';
import { RegistryContext } from '@effect/atom-react';
import * as Effect from 'effect/Effect';
import * as DevClient from 'expo-dev-client';
import { useFonts } from 'expo-font';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { HostKeyPrompt } from '@/components/HostKeyPrompt';
import { atomRegistry } from '@/lib/atom-registry';
import { appRuntime } from '@/lib/runtime';
import { appFonts } from '../lib/fonts';
import { seedScreenshotData } from '../lib/screenshot-seed';
import { initAppTheme, useSystemThemeSync } from '../lib/theme';

appRuntime.runSync(
	Effect.logInfo('Fressh App Init', {
		isLiquidGlassAvailable: isLiquidGlassAvailable(),
	}),
);

void DevClient.registerDevMenuItems([
	{
		callback: () => {
			appRuntime.runSync(Effect.logInfo('Hello from dev menu'));
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

	// While the Native theme is selected, follow the device light/dark setting
	// (no-op for the always-dark stylized themes). Must run before the early
	// return below so the hook order stays stable.
	useSystemThemeSync();

	// Seed demo data for marketing screenshots. No-op unless the build sets
	// EXPO_PUBLIC_SCREENSHOT_SEED=1, so this never runs in production.
	useEffect(() => {
		appRuntime.runFork(seedScreenshotData);
	}, []);

	// Load the design typefaces before first paint (runtime, via expo-font).
	const [fontsLoaded, fontError] = useFonts(appFonts);

	if (!fontsLoaded && !fontError) {
		return null;
	}

	return (
		// Supply OUR registry (lib/atom-registry.ts) so the atom hooks share the
		// instance the event plane and Effect programs write to imperatively.
		<RegistryContext.Provider value={atomRegistry}>
			<GestureHandlerRootView style={{ flex: 1 }}>
				<KeyboardProvider>
					<Stack screenOptions={{ headerShown: false }} />
					{/* Global host-key trust prompt — one mount covers every connect
					    path (connect form, reconnect, Commands-tab runner). */}
					<HostKeyPrompt />
				</KeyboardProvider>
			</GestureHandlerRootView>
		</RegistryContext.Provider>
	);
}
