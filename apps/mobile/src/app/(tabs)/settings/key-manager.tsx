import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyList } from '@/components/key-manager/KeyList';

export default function SettingsKeyManager() {
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: '#0B1324' }}>
			<Stack.Screen options={{ title: 'Manage Keys' }} />
			<KeyList mode="manage" />
		</SafeAreaView>
	);
}
