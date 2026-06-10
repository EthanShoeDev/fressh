import { useAtomValue } from '@effect/atom-react';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { View } from 'react-native';
import { ScreenHeader } from '@/components/themed/ScreenHeader';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
import { ThemedText } from '@/components/themed/ThemedText';
import { KeyList } from '@/components/key-manager/KeyList';
import { secretsManager } from '@/lib/secrets-manager';

/**
 * Keys is a top-level tab in the Option-3 IA (promoted out of Settings). Hosts
 * the same manage-mode key list the settings sub-screen used to, on the active
 * theme's canvas with an inline themed header showing the live key count.
 */
export default function KeysScreen() {
	return (
		<ThemedScreen edges={['top']}>
			<View className='flex-1'>
				<ScreenHeader title='Keys' right={<KeyCount />} />
				<KeyList mode='manage' />
			</View>
		</ThemedScreen>
	);
}

function KeyCount() {
	const listResult = useAtomValue(secretsManager.keys.atoms.list);
	const count = AsyncResult.isSuccess(listResult) ? listResult.value.length : 0;
	if (!AsyncResult.isSuccess(listResult) || count === 0) {
		return null;
	}
	return (
		<ThemedText
			mono
			className='text-[11px] font-bold uppercase text-muted'
			style={{ letterSpacing: 0.5 }}
		>
			{count} {count === 1 ? 'key' : 'keys'}
		</ThemedText>
	);
}
