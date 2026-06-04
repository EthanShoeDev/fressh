import { Stack } from 'expo-router';
import { useCSSVariable, useResolveClassNames } from 'uniwind';

export default function SettingsStackLayout() {
	// expo-router header options need plain style/color values, so resolve the
	// theme tokens out of uniwind rather than passing classNames.
	const headerStyle = useResolveClassNames('bg-surface');
	const headerTitleStyle = useResolveClassNames('text-text-primary');
	const headerTintColor = useCSSVariable('--color-text-primary') as string;

	return (
		<Stack screenOptions={{ headerStyle, headerTitleStyle, headerTintColor }}>
			<Stack.Screen name='index' options={{ title: 'Settings' }} />
			<Stack.Screen name='terminal' options={{ title: 'Terminal' }} />
		</Stack>
	);
}
