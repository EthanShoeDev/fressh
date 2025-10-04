import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import {
	Icon,
	Label,
	NativeTabs,
	VectorIcon,
} from 'expo-router/unstable-native-tabs';
import React from 'react';
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
			backBehavior="initialRoute"
			indicatorColor={theme.colors.primary}
			// labelVisibilityMode="labeled"
			// rippleColor={theme.colors.transparent}
			// ios
			// blurEffect="systemChromeMaterial"
			// disableTransparentOnScrollEdge={true}
		>
			<NativeTabs.Trigger name="index">
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>Hosts</Label>
				<Icon
					src={<VectorIcon family={FontAwesome6} name="server" />}
					selectedColor={theme.colors.textPrimary}
				/>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="shell">
				<Icon
					src={<VectorIcon family={MaterialCommunityIcons} name="console" />}
					selectedColor={theme.colors.textPrimary}
				/>
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>
					Shells
				</Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings">
				<Icon
					src={<VectorIcon family={MaterialCommunityIcons} name="cog" />}
					selectedColor={theme.colors.textPrimary}
				/>
				<Label selectedStyle={{ color: theme.colors.textPrimary }}>
					Settings
				</Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
