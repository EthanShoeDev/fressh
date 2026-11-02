import type { ViewStyle } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useThemeSkin } from '@/lib/theme-skin';

/**
 * Skin-aware surface style: theme radius (0 = sharp for Monolith), translucent
 * "glass" fill for Aurora, optional accent glow. Apply to a `Pressable`/`View`
 * directly so interactive cards stay one element.
 */
export function useSurfaceStyle(opts?: {
  glow?: boolean | undefined;
  /** Use the smaller control radius (buttons/search) instead of card radius. */
  control?: boolean | undefined;
  /** Force an opaque surface even under a glass theme (e.g. bottom sheets). */
  opaque?: boolean | undefined;
}): ViewStyle {
  const skin = useThemeSkin();
  const surface = useCSSVariable('--color-surface') as string;
  const border = useCSSVariable('--color-border') as string;
  const glass = skin.glass && opts?.opaque !== true;
  return {
    backgroundColor: glass ? 'rgba(255,255,255,0.06)' : surface,
    borderColor: glass ? 'rgba(255,255,255,0.14)' : border,
    borderWidth: 1,
    borderRadius: opts?.control === true ? skin.controlRadius : skin.radius,
    boxShadow: opts?.glow === true && skin.glow ? skin.glow : undefined,
  };
}
