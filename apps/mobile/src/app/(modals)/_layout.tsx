import { Stack } from 'expo-router';

export default function ModalsLayout() {
	return (
		<Stack
			screenOptions={{
				presentation: 'modal',
				headerBlurEffect: 'systemMaterial',
				headerTransparent: true,
			}}
		/>
	);
}
