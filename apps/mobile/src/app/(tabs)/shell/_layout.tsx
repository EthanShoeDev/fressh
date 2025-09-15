import { Stack } from 'expo-router';
import React from 'react';

export default function TabsShellStack() {
	return (
		<Stack
			screenOptions={{
				headerBlurEffect: 'systemMaterial',
				headerTransparent: true,
			}}
		>
			<Stack.Screen name="index" options={{ title: 'Shells' }} />
			<Stack.Screen
				name="[connectionId]/[channelId]"
				options={{ title: 'SSH Shell' }}
			/>
		</Stack>
	);
}
