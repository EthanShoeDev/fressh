import { Stack } from 'expo-router';
import React from 'react';
import { useTheme } from '@/lib/theme';

export default function TabsShellStack() {
	const theme = useTheme();
	return (
		<Stack
			screenOptions={{
				headerBlurEffect: undefined,
				headerTransparent: false,
				headerStyle: { backgroundColor: theme.colors.surface },
				headerTintColor: theme.colors.textPrimary,
				headerTitleStyle: {
					color: theme.colors.textPrimary,
				},
			}}
		>
			<Stack.Screen name="index" options={{ title: 'Shells' }} />
			<Stack.Screen name="detail" options={{ title: 'SSH Shell' }} />
		</Stack>
	);
}
