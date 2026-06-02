import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
	const theme = useTheme();
	return (
		<NativeTabs
			// common
			backgroundColor={theme.colors.surface}
			iconColor={theme.colors.muted}
			labelStyle={{ color: theme.colors.muted }}
			tintColor={theme.colors.primary}
			shadowColor={theme.colors.shadow}
			// android
			backBehavior='initialRoute'
			indicatorColor={theme.colors.primary}
			// labelVisibilityMode="labeled"
			// rippleColor={theme.colors.transparent}
			// ios
			// blurEffect="systemChromeMaterial"
			// disableTransparentOnScrollEdge={true}
		>
			<NativeTabs.Trigger name='index'>
				<NativeTabs.Trigger.Label
					selectedStyle={{ color: theme.colors.textPrimary }}
				>
					Hosts
				</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon
					src={
						<NativeTabs.Trigger.VectorIcon
							family={FontAwesome6}
							name='server'
						/>
					}
					selectedColor={theme.colors.textPrimary}
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
					selectedColor={theme.colors.textPrimary}
				/>
				<NativeTabs.Trigger.Label
					selectedStyle={{ color: theme.colors.textPrimary }}
				>
					Shells
				</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name='terminal-test'>
				<NativeTabs.Trigger.Icon
					src={
						<NativeTabs.Trigger.VectorIcon
							family={MaterialCommunityIcons}
							name='monitor'
						/>
					}
					selectedColor={theme.colors.textPrimary}
				/>
				<NativeTabs.Trigger.Label
					selectedStyle={{ color: theme.colors.textPrimary }}
				>
					Term
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
					selectedColor={theme.colors.textPrimary}
				/>
				<NativeTabs.Trigger.Label
					selectedStyle={{ color: theme.colors.textPrimary }}
				>
					Settings
				</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
