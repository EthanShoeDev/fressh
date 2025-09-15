import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function SettingsStackLayout() {
	const theme = useTheme();
	return (
		<Stack
			screenOptions={{
				headerStyle: { backgroundColor: theme.colors.surface },
				headerTitleStyle: { color: theme.colors.textPrimary },
				headerTintColor: theme.colors.textPrimary,
			}}
		>
			<Stack.Screen name="index" options={{ title: 'Settings' }} />
		</Stack>
	);
}
