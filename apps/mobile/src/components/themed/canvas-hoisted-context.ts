import { createContext } from 'react';

/**
 * True when a single persistent `ThemedBackground` is hosted ABOVE the tab
 * navigator (`JsTabsLayout`), so per-screen scaffolds must not paint their own
 * canvas or an opaque background over it. Hoisting is what makes tab switches
 * seamless: a per-screen WebGPU surface is torn down whenever its tab hides,
 * so coming back means a from-scratch surface re-init (black, then a frame
 * ~1s later). One canvas above the navigator never unmounts. (The RN-view
 * renderer has no such teardown, but hoisting is harmless there.)
 *
 * Screens outside the JS tab navigator (native tabs, modals) get the default
 * `false` and keep their own per-screen canvas — there the teardown crash is
 * handled by the react-native-webgpu patch (see docs/bun-patches.md).
 */
export const CanvasHoistedContext = createContext(false);
