import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useCSSVariable, useUniwind } from 'uniwind';
import { TAB_ROUTES } from '@/lib/tab-bar-config';
import { NATIVE_TAB_STYLES, type AppThemeName } from '@/lib/theme';

/**
 * The native bottom tab bar (`expo-router/unstable-native-tabs`). Fast and
 * platform-correct (iOS liquid-glass / Material), but only partially styleable —
 * see `JsTabsLayout` + `CustomTabBar` for the fully theme-driven alternative.
 * `(tabs)/_layout.tsx` picks between the two.
 *
 * No themed canvas is hosted here. The native tab navigator hosts each scene in
 * a fragment and tears it down on switch (`remove+add`, rn-screens
 * `TabsContainer`), and ANYTHING placed behind the tab host is occluded by that
 * fragment layer at the Android compositing level — verified for both the WebGPU
 * `TextureView` AND a plain RN view (both showed a solid background color, no
 * gradient). So canvas themes fall back to the per-screen `ThemedBackground` in
 * `ThemedScreen` (the gradient shows, but repaints on each switch). A seamless
 * animated background needs the JS tab bar; see
 * docs/projects/themed-gradient-background.md.
 */
export function NativeTabsLayout() {
	// NativeTabs is a third-party component taking plain color strings, so
	// resolve the theme tokens out of uniwind instead of using classNames.
	const [surface, muted, primary, shadow, textPrimary] = useCSSVariable([
		'--color-surface',
		'--color-muted',
		'--color-primary',
		'--color-shadow',
		'--color-text-primary',
	]) as [string, string, string, string, string];

	// We can't fully reproduce each theme's bespoke stylized bar with the native
	// (liquid-glass / Material) tab bar, but we push every native lever we have:
	// color tokens above + label typography + iOS blur below. See
	// `NATIVE_TAB_STYLES` for the per-theme intent.
	const { theme } = useUniwind();
	const tabStyle = NATIVE_TAB_STYLES[theme as AppThemeName];

	return (
		<NativeTabs
			// common
			backgroundColor={surface}
			iconColor={muted}
			labelStyle={{
				color: muted,
				fontFamily: tabStyle?.labelFontFamily,
				fontWeight: tabStyle?.labelFontWeight,
			}}
			tintColor={primary}
			shadowColor={shadow}
			// android
			backBehavior='initialRoute'
			indicatorColor={primary}
			// always show every tab's text label (default 'auto' labels only the
			// active tab on Android); no-op on iOS.
			labelVisibilityMode='labeled'
			// ios — theme-driven blur (frosted glass for Aurora, chrome for the
			// terminal-flavored themes); falls back to the system default.
			blurEffect={tabStyle?.blurEffect}
		>
			{TAB_ROUTES.map((route) => (
				<NativeTabs.Trigger key={route.name} name={route.name}>
					<NativeTabs.Trigger.Label selectedStyle={{ color: textPrimary }}>
						{route.label}
					</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon
						src={
							<NativeTabs.Trigger.VectorIcon
								family={route.iconFamily}
								name={route.icon}
							/>
						}
						selectedColor={textPrimary}
					/>
				</NativeTabs.Trigger>
			))}
		</NativeTabs>
	);
}
