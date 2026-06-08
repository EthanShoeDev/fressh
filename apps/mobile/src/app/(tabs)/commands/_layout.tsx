import { Stack } from 'expo-router';
import { useThemedHeader } from '@/components/themed/useThemedHeader';

export default function CommandsStackLayout() {
	const header = useThemedHeader();
	return (
		<Stack screenOptions={header.screenOptions}>
			{/* Root renders its own inline themed header (like Servers/Settings). */}
			<Stack.Screen name='index' options={{ headerShown: false }} />
		</Stack>
	);
}
