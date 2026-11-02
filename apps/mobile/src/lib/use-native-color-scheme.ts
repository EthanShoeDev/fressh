import { useUniwind } from 'uniwind';

/**
 * The color scheme to pass to an `@expo/ui` `<Host>`, derived from the RESOLVED
 * uniwind theme (the same source the color tokens use): the SwiftUI/Compose
 * host does not reliably follow `Appearance.setColorScheme`'s window override,
 * so a forced Light/Dark (the Appearance pref) would flip the RN chrome but
 * leave the native form on the device scheme. `native-light` is the only light
 * variant; every other resolved theme (native dark + the stylized themes) is
 * dark.
 */
export function useNativeColorScheme() {
  const { theme } = useUniwind();
  return theme === 'native-light' ? 'light' : 'dark';
}
