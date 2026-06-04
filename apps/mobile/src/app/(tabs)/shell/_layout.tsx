import { Stack } from 'expo-router';
import { useCSSVariable, useResolveClassNames } from 'uniwind';

export default function TabsShellStack() {
	const headerStyle = useResolveClassNames('bg-surface');
	const headerTitleStyle = useResolveClassNames('text-text-primary');
	const headerTintColor = useCSSVariable('--color-text-primary') as string;

	return (
		<Stack
			screenOptions={{
				headerBlurEffect: undefined,
				headerTransparent: false,
				headerStyle,
				headerTintColor,
				headerTitleStyle,
			}}
		>
			<Stack.Screen name='index' options={{ title: 'Shells' }} />
			<Stack.Screen name='detail' options={{ title: 'SSH Shell' }} />
		</Stack>
	);
}
