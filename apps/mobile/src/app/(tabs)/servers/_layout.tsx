import { Stack } from 'expo-router';
import { useThemedHeader } from '@/components/themed/useThemedHeader';

export default function ServersStackLayout() {
	const header = useThemedHeader();
	return (
		<Stack screenOptions={header.screenOptions}>
			{/* index/detail/connect render their own inline themed header on the
			    gradient canvas; only the terminal keeps the native bar. */}
			<Stack.Screen name='index' options={{ headerShown: false }} />
			<Stack.Screen name='detail' options={{ headerShown: false }} />
			<Stack.Screen name='connect' options={{ headerShown: false }} />
			<Stack.Screen
				name='terminal'
				options={{ title: header.title('SSH Shell') }}
			/>
		</Stack>
	);
}
