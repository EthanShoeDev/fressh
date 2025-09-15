import { Stack } from 'expo-router';

export default function ShellStackLayout() {
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
