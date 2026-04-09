import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SecurityCenterScreen } from '@/components/security-center/SecurityCenterScreen';
import { useTheme } from '@/lib/theme';

export default function SettingsSecurityCenter() {
	const theme = useTheme();
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Stack.Screen options={{ title: 'Security Center' }} />
			<SecurityCenterScreen />
		</SafeAreaView>
	);
}
