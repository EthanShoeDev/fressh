import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useCSSVariable, useUniwind } from 'uniwind';
import { NATIVE_TAB_STYLES, type AppThemeName } from '@/lib/theme';

export default function TabsLayout() {
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
			// ios — theme-driven blur (frosted glass for Aurora, chrome for the
			// terminal-flavored themes); falls back to the system default.
			blurEffect={tabStyle?.blurEffect}
		>
			<NativeTabs.Trigger name='servers'>
				<NativeTabs.Trigger.Label selectedStyle={{ color: textPrimary }}>
					Servers
				</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon
					src={
						<NativeTabs.Trigger.VectorIcon
							family={FontAwesome6}
							name='server'
						/>
					}
					selectedColor={textPrimary}
				/>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name='keys'>
				<NativeTabs.Trigger.Icon
					src={
						<NativeTabs.Trigger.VectorIcon
							family={MaterialCommunityIcons}
							name='key-variant'
						/>
					}
					selectedColor={textPrimary}
				/>
				<NativeTabs.Trigger.Label selectedStyle={{ color: textPrimary }}>
					Keys
				</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name='settings'>
				<NativeTabs.Trigger.Icon
					src={
						<NativeTabs.Trigger.VectorIcon
							family={MaterialCommunityIcons}
							name='cog'
						/>
					}
					selectedColor={textPrimary}
				/>
				<NativeTabs.Trigger.Label selectedStyle={{ color: textPrimary }}>
					Settings
				</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
