import { Stack } from 'expo-router';
import { useThemedHeader } from '@/components/themed/useThemedHeader';

export default function KeysStackLayout() {
	const header = useThemedHeader();
	return (
		<Stack screenOptions={header.screenOptions}>
			{/* Inline themed header rendered on the gradient canvas. */}
			<Stack.Screen name='index' options={{ headerShown: false }} />
		</Stack>
	);
}
