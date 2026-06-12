import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { Scanlines } from '@/components/themed/ThemedBackground';
import { JS_TAB_BAR_HEIGHT, TAB_ROUTES } from '@/lib/tab-bar-config';
import { applyCase, resolveFont, useThemeSkin } from '@/lib/theme-skin';

/** `#rrggbb` → `rgba(r,g,b,a)` for translucent accent tints (active-pill fill). */
function hexToRgba(hex: string, alpha: number) {
	const h = hex.replace('#', '');
	if (h.length !== 6) {
		return hex;
	}
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Fully custom, React-rendered bottom tab bar. Unlike the native bar it inherits
 * the active theme's *skin* so each theme's bar matches the rest of its UI:
 *
 * - Rounded themes (Aurora/Graphite/Phosphor/default) render a **floating pill** —
 *   inset from the edges, fully rounded, glass-frosted for Aurora — with an
 *   accent-tinted, glowing **highlight behind the active tab** (mirrors the
 *   design mocks' stylized bars).
 * - Monolith (`edgeToEdge`) stays a flush, sharp, edge-to-edge segmented bar whose
 *   active tab is a solid lime fill with dark on-primary label — exactly the
 *   brutalist bar that can't be done natively.
 *
 * Wired into the JS tab navigator via `JsTabsLayout`'s `tabBar` prop.
 */
export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
	const skin = useThemeSkin();
	const insets = useSafeAreaInsets();
	const [surface, border, muted, primary, onPrimary] = useCSSVariable([
		'--color-surface',
		'--color-border',
		'--color-muted',
		'--color-primary',
		'--color-button-text-on-primary',
	]) as [string, string, string, string, string];

	const glass = skin.glass;
	const float = !skin.edgeToEdge;

	// The bar reserves `JS_TAB_BAR_HEIGHT + insets.bottom` (see useBottomTabSpacing).
	// For the floating variant we spend a little of that on top padding so the pill
	// hovers; the inner height shrinks to keep the reserved footprint identical.
	const topPad = float ? 8 : 0;
	const innerHeight = JS_TAB_BAR_HEIGHT - topPad;

	return (
		<View
			style={{
				paddingTop: topPad,
				paddingBottom: insets.bottom,
				paddingHorizontal: float ? 14 : 0,
				backgroundColor: 'transparent',
			}}
		>
			<View
				style={{
					flexDirection: 'row',
					alignItems: 'stretch',
					height: innerHeight,
					paddingHorizontal: float ? 7 : 0,
					backgroundColor: glass ? 'rgba(255,255,255,0.06)' : surface,
					borderColor: glass ? 'rgba(255,255,255,0.14)' : border,
					borderWidth: float ? 1 : 0,
					borderTopWidth: 1,
					borderRadius: float ? skin.radius : 0,
					boxShadow: skin.glow || undefined,
					// Clip the scanline overlay to the rounded corners (Phosphor). The
					// boxShadow glow is painted outside the element, so it's unaffected.
					overflow: skin.scanlines ? 'hidden' : 'visible',
				}}
			>
				{skin.scanlines ? <Scanlines /> : null}

				{state.routes.map((route, index) => {
					const meta = TAB_ROUTES.find((r) => r.name === route.name);
					if (!meta) {
						return null;
					}
					const focused = state.index === index;
					const Icon = meta.iconFamily;

					// Active tint: a solid accent fill on Monolith (dark on-primary label),
					// a soft translucent accent pill everywhere else (accent-coloured label).
					const activeColor = skin.edgeToEdge ? onPrimary : primary;
					const color = focused ? activeColor : muted;
					const highlightStyle = focused
						? skin.edgeToEdge
							? { backgroundColor: primary, borderRadius: 0 }
							: {
									backgroundColor: hexToRgba(primary, 0.14),
									borderRadius: skin.controlRadius + 2,
									boxShadow: skin.glow || undefined,
								}
						: undefined;

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
							className='flex-1 items-stretch justify-center'
							style={float ? { paddingVertical: 6 } : undefined}
						>
							<View
								className='flex-1 items-center justify-center gap-1'
								style={[
									highlightStyle,
									float ? { marginHorizontal: 4 } : undefined,
								]}
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
							</View>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}
