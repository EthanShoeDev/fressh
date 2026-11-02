import { Host } from '@expo/ui';
import type { ReactNode } from 'react';

import { useNativeColorScheme } from '@/lib/use-native-color-scheme';

/** Props of every Native-theme form container. */
export type NativeFormProps = { children: ReactNode };

/**
 * The one `<Host>` a Native-theme settings screen gets, shared by the iOS and
 * Android `NativeForm`s. HARD LAYOUT RULE (see native-ui-theme doc): exactly
 * ONE `<Host>` per screen and it is the OUTERMOST native element; the form
 * inside scrolls itself. Never nest a `<Host>` in a ScrollView, use
 * `matchContents`, or give each control its own Host — re-entrant Compose
 * measure crashes Android.
 */
export function NativeFormHost({ children }: NativeFormProps) {
  const colorScheme = useNativeColorScheme();
  return (
    <Host style={{ flex: 1 }} colorScheme={colorScheme}>
      {children}
    </Host>
  );
}
