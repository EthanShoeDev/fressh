import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useCSSVariable } from 'uniwind';

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
	return (
		<NativeTabs
			// common
			backgroundColor={surface}
			iconColor={muted}
			labelStyle={{ color: muted }}
			tintColor={primary}
			shadowColor={shadow}
			// android
			backBehavior='initialRoute'
			indicatorColor={primary}
			// labelVisibilityMode="labeled"
			// rippleColor='transparent'
			// ios
			// blurEffect="systemChromeMaterial"
			// disableTransparentOnScrollEdge={true}
		>
			<NativeTabs.Trigger name='index'>
				<NativeTabs.Trigger.Label selectedStyle={{ color: textPrimary }}>
					Hosts
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
			<NativeTabs.Trigger name='shell'>
				<NativeTabs.Trigger.Icon
					src={
						<NativeTabs.Trigger.VectorIcon
							family={MaterialCommunityIcons}
							name='console'
						/>
					}
					selectedColor={textPrimary}
				/>
				<NativeTabs.Trigger.Label selectedStyle={{ color: textPrimary }}>
					Shells
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
