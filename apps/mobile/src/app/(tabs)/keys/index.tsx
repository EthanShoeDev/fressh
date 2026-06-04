import { View } from 'react-native';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
import { KeyList } from '@/components/key-manager/KeyList';

/**
 * Keys is a top-level tab in the Option-3 IA (promoted out of Settings). Hosts
 * the same manage-mode key list the settings sub-screen used to, on the active
 * theme's canvas with an inline themed header.
 */
export default function KeysScreen() {
	return (
		<ThemedScreen edges={['top']}>
			<View className='flex-1'>
				<ScreenHeader title='Keys' />
				<KeyList mode='manage' />
			</View>
		</ThemedScreen>
	);
}
