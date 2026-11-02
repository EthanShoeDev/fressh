import { use } from 'react';
import { View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { CanvasHoistedContext } from './canvas-hoisted-context';
import { ThemedBackground } from './themed-background';

const DEFAULT_EDGES: readonly Edge[] = ['top'];

/**
 * Screen scaffold that paints the active theme's canvas (gradient blobs +
 * scanlines) behind a safe-area content area. Use in place of a bare
 * `SafeAreaView` so every screen inherits the theme's background character.
 *
 * Under the JS tab navigator (`CanvasHoistedContext`) the canvas — and the
 * background color — live ABOVE the navigator in `JsTabsLayout`, so this
 * scaffold stays fully transparent to let the one persistent surface show
 * through; per-screen surfaces would be torn down (and re-init black) on every
 * tab switch. Everywhere else (native tabs, modals) the canvas renders per
 * screen, because opaque native-tab scenes occlude anything hosted behind the
 * navigator. The teardown crash per-screen rendering risks (surface destroyed
 * mid-render-loop) is handled by the react-native-webgpu patch (see
 * docs/bun-patches.md), which guards the null texture instead of crashing.
 */
export function ThemedScreen({
  children,
  edges = DEFAULT_EDGES,
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
}) {
  const hoisted = use(CanvasHoistedContext);
  const background = useCSSVariable('--color-background') as string;
  // Non-hoisted screens (native tabs, modals) always paint their own canvas, and
  // it STAYS mounted while the screen is blurred. We deliberately do not gate it
  // on focus: any GPU-surface teardown when a native tab hides is the renderer's
  // problem and is handled inside react-native-webgpu (the Dawn `bun patch` — see
  // docs/bun-patches.md), NOT by manually unmounting from app code. An earlier
  // `useIsFocused()` gate that dropped the canvas on blur was the *cause* of the
  // native-bar "black flicker" — it tore the gradient down mid-switch so the flat
  // per-screen `background` flashed through. See
  // docs/projects/themed-gradient-background.md.
  return (
    <View
      style={{ flex: 1, backgroundColor: hoisted ? 'transparent' : background }}
    >
      {hoisted ? null : <ThemedBackground />}
      <SafeAreaView style={{ flex: 1 }} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}
