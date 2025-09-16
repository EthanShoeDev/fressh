import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyList } from '@/components/key-manager/KeyList';

export default function KeyManagerModalRoute() {
	const router = useRouter();
	const params = useLocalSearchParams<{ select?: string }>();
	const selectMode = params.select === '1';

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: '#0B1324' }}>
			<Stack.Screen
				options={{
					title: selectMode ? 'Select Key' : 'Manage Keys',
					headerRight: () => (
						<Pressable onPress={() => router.back()}>
							<Text style={{ color: '#E5E7EB', fontWeight: '700' }}>Close</Text>
						</Pressable>
					),
				}}
			/>
			<KeyList
				mode={selectMode ? 'select' : 'manage'}
				onSelect={async () => router.back()}
			/>
		</SafeAreaView>
	);
}
