import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { CustomTabBar } from '@/components/navigation/CustomTabBar';
import {
	CanvasHoistedContext,
	ThemedBackground,
} from '@/components/themed/ThemedBackground';
import { TAB_ROUTES } from '@/lib/tab-bar-config';

/**
 * The JS (React Navigation) tab navigator, rendered with our fully custom,
 * theme-driven `CustomTabBar` instead of the system bar. The styleable
 * alternative to `NativeTabsLayout`; `(tabs)/_layout.tsx` picks between them.
 *
 * Headers stay off — each tab folder owns a nested `Stack` that renders its own
 * header (same as the native layout).
 */
export function JsTabsLayout() {
	// The bottom-tab navigator (`SafeAreaProviderCompat`) paints NO background, so
	// the window — white on Android — shows through the custom bar's rounded top
	// corners and the hairline below it. Paint the app canvas behind the whole
	// navigator so those areas match the rest of the screen.
	const background = useCSSVariable('--color-background') as string;

	// ONE persistent theme canvas for every tab, hosted above the navigator so it
	// never unmounts: a per-screen WebGPU surface is torn down whenever its tab
	// hides, so each switch re-inits the surface from scratch (black, then a
	// frame ~1s later). Hosting it here keeps the render surface alive across
	// switches — the scenes, their nested stacks, and `ThemedScreen` all stay
	// transparent (via `CanvasHoistedContext`) so it shows through. This only
	// works on the JS navigator: native tab scenes are opaque and would occlude
	// the canvas (see NativeTabsLayout / ThemedScreen for the per-screen fallback).
	return (
		<CanvasHoistedContext.Provider value={true}>
			<View style={{ flex: 1, backgroundColor: background }}>
				<ThemedBackground />
				<Tabs
					// Keep hidden tab scenes ATTACHED (display:none) instead of letting
					// react-native-screens detach their fragments on every switch. The
					// detach/re-attach forced a full native re-layout of the returning
					// tab's nested stack each time — the JS bar felt sluggish on every
					// theme while the native bar (which keeps its scenes alive) was
					// instant. Keeping scenes attached makes a switch a pure visibility
					// flip, and any native surface in a hidden tab (e.g. the terminal)
					// survives instead of being torn down and re-created.
					detachInactiveScreens={false}
					screenOptions={{
						headerShown: false,
						sceneStyle: { backgroundColor: 'transparent' },
					}}
					tabBar={(props) => <CustomTabBar {...props} />}
				>
					{TAB_ROUTES.map((route) => (
						<Tabs.Screen
							key={route.name}
							name={route.name}
							options={{ title: route.label }}
						/>
					))}
				</Tabs>
			</View>
		</CanvasHoistedContext.Provider>
	);
}
