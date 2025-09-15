import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyList } from '@/components/key-manager/KeyList';
import { useTheme } from '@/lib/theme';

export default function SettingsKeyManager() {
	const theme = useTheme();
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Stack.Screen options={{ title: 'Manage Keys' }} />
			<KeyList mode="manage" />
		</SafeAreaView>
	);
}
