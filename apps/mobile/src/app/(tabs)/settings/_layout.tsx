import { Stack } from 'expo-router';
import { useThemedHeader } from '@/components/themed/useThemedHeader';

export default function SettingsStackLayout() {
	const header = useThemedHeader();
	return (
		<Stack screenOptions={header.screenOptions}>
			{/* Settings root renders its own inline themed header; the Terminal
			    sub-screen keeps the native bar (it's a deeper form route). */}
			<Stack.Screen name='index' options={{ headerShown: false }} />
			<Stack.Screen
				name='appearance'
				options={{ title: header.title('Appearance') }}
			/>
			<Stack.Screen
				name='terminal'
				options={{ title: header.title('Terminal') }}
			/>
			<Stack.Screen
				name='known-hosts'
				options={{ title: header.title('Known hosts') }}
			/>
		</Stack>
	);
}
