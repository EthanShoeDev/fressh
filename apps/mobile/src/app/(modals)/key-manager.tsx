import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { KeyList } from '@/components/key-manager/KeyList';

export default function KeyManagerModalRoute() {
	const router = useRouter();
	const params = useLocalSearchParams<{ select?: string }>();
	const selectMode = params.select === '1';
	const background = useCSSVariable('--color-background') as string;

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: background }}>
			<Stack.Screen
				options={{
					title: selectMode ? 'Select Key' : 'Manage Keys',
					headerRight: () => (
						<Pressable
							onPress={() => {
								router.back();
							}}
						>
							<Text className='font-bold text-text-primary'>Close</Text>
						</Pressable>
					),
				}}
			/>
			<KeyList
				mode={selectMode ? 'select' : 'manage'}
				onSelect={() => {
					router.back();
				}}
			/>
		</SafeAreaView>
	);
}
