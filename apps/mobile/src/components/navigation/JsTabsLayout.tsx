import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { CustomTabBar } from '@/components/navigation/CustomTabBar';
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
	// navigator so those areas match the rest of the screen. Scenes paint their own
	// `ThemedScreen` background on top, so we keep `sceneStyle` transparent.
	const background = useCSSVariable('--color-background') as string;

	return (
		<View style={{ flex: 1, backgroundColor: background }}>
			<Tabs
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
	);
}
