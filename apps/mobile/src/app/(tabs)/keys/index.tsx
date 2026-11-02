import { useAtomValue } from '@effect/atom-react';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { View } from 'react-native';

import { KeyList } from '@/components/key-manager/key-list';
import { ScreenHeader } from '@/components/themed/screen-header';
import { ThemedScreen } from '@/components/themed/themed-screen';
import { ThemedText } from '@/components/themed/themed-text';
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
      className='text-[11px] font-bold text-muted uppercase'
      style={{ letterSpacing: 0.5 }}
    >
      {count} {count === 1 ? 'key' : 'keys'}
    </ThemedText>
  );
}
