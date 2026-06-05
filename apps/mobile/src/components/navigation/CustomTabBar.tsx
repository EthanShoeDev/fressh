import { Canvas } from '@shopify/react-native-skia';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { Scanlines } from '@/components/themed/ThemedBackground';
import { JS_TAB_BAR_HEIGHT, TAB_ROUTES } from '@/lib/tab-bar-config';
import { applyCase, resolveFont, useThemeSkin } from '@/lib/theme-skin';

/**
 * Fully custom, React-rendered bottom tab bar. Unlike the native bar it inherits
 * the active theme's *skin* — radius, glass fill, accent glow, CRT scanlines, and
 * the mono/cased label voice — so each theme's bar matches the rest of its UI.
 * Wired into the JS tab navigator via `JsTabsLayout`'s `tabBar` prop.
 */
export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
	const skin = useThemeSkin();
	const insets = useSafeAreaInsets();
	const [surface, border, muted, textPrimary] = useCSSVariable([
		'--color-surface',
		'--color-border',
		'--color-muted',
		'--color-text-primary',
	]) as [string, string, string, string];

	const glass = skin.glass;

	return (
		<View
			style={{
				flexDirection: 'row',
				height: JS_TAB_BAR_HEIGHT + insets.bottom,
				paddingBottom: insets.bottom,
				backgroundColor: glass ? 'rgba(255,255,255,0.06)' : surface,
				borderTopWidth: 1,
				borderTopColor: glass ? 'rgba(255,255,255,0.14)' : border,
				borderTopLeftRadius: skin.radius,
				borderTopRightRadius: skin.radius,
				boxShadow: skin.glow || undefined,
				// Clip the scanline overlay to the rounded top corners (Phosphor only;
				// other themes skip overflow so their accent glow isn't clipped).
				overflow: skin.scanlines ? 'hidden' : 'visible',
			}}
		>
			{skin.scanlines ? (
				<Canvas style={StyleSheet.absoluteFill} pointerEvents='none'>
					<Scanlines />
				</Canvas>
			) : null}

			{state.routes.map((route, index) => {
				const meta = TAB_ROUTES.find((r) => r.name === route.name);
				if (!meta) {
					return null;
				}
				const focused = state.index === index;
				const color = focused ? textPrimary : muted;
				const Icon = meta.iconFamily;

				const onPress = () => {
					const event = navigation.emit({
						type: 'tabPress',
						target: route.key,
						canPreventDefault: true,
					});
					if (!focused && !event.defaultPrevented) {
						navigation.navigate(route.name);
					}
				};

				return (
					<Pressable
						key={route.key}
						onPress={onPress}
						accessibilityRole='button'
						accessibilityState={{ selected: focused }}
						accessibilityLabel={meta.label}
						className='flex-1 items-center justify-center gap-1'
					>
						<Icon name={meta.icon} size={22} color={color} />
						<Text
							numberOfLines={1}
							style={{
								color,
								fontSize: 11,
								fontWeight: focused ? '700' : '500',
								fontFamily: resolveFont(skin, {
									mono: skin.mono,
									weight: focused ? '700' : '500',
								}),
								letterSpacing: skin.tracking,
							}}
						>
							{applyCase(skin, meta.label)}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
