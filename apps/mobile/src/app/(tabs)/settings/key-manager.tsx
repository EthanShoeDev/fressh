import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { KeyList } from '@/components/key-manager/KeyList';

export default function SettingsKeyManager() {
	const background = useCSSVariable('--color-background') as string;
	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: background }}>
			<Stack.Screen options={{ title: 'Manage Keys' }} />
			<KeyList mode='manage' />
		</SafeAreaView>
	);
}
