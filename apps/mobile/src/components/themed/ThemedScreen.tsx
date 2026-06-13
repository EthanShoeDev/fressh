import { useIsFocused } from 'expo-router';
import { use } from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useThemeSkin } from '@/lib/theme-skin';
import { CanvasHoistedContext, ThemedBackground } from './ThemedBackground';

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
	// Per-screen canvases mount only while the screen is FOCUSED. The native tab
	// navigator destroys a hidden tab's surface regardless, so a blurred screen's
	// render loop would spin on an abandoned surface — observed as the canvas
	// stuck solid black after a switch (the loop kept drawing into the webgpu
	// patch's discarded fallback texture and never re-attached), and as worklet
	// JNI aborts (tombstones: uncaught JniException on the worklet thread).
	// Unmounting on blur stops the loop cleanly; refocus mounts a fresh surface.
	// The re-init fade on return is inherent to per-screen surfaces — the hoisted
	// path above is the seamless one. (Does not apply to the hoisted canvas,
	// which lives outside any screen and must never unmount.)
	const focused = useIsFocused();
	return (
		<View
			style={{ flex: 1, backgroundColor: hoisted ? 'transparent' : background }}
		>
			{hoisted || !focused ? null : <ThemedBackground />}
			<SafeAreaView style={{ flex: 1 }} edges={edges}>
				{children}
			</SafeAreaView>
		</View>
	);
}

/**
 * Skin-aware surface style: theme radius (0 = sharp for Monolith), translucent
 * "glass" fill for Aurora, optional accent glow. Apply to a `Pressable`/`View`
 * directly so interactive cards stay one element.
 */
export function useSurfaceStyle(opts?: {
	glow?: boolean;
	/** Use the smaller control radius (buttons/search) instead of card radius. */
	control?: boolean;
	/** Force an opaque surface even under a glass theme (e.g. bottom sheets). */
	opaque?: boolean;
}): ViewStyle {
	const skin = useThemeSkin();
	const surface = useCSSVariable('--color-surface') as string;
	const border = useCSSVariable('--color-border') as string;
	const glass = skin.glass && !opts?.opaque;
	return {
		backgroundColor: glass ? 'rgba(255,255,255,0.06)' : surface,
		borderColor: glass ? 'rgba(255,255,255,0.14)' : border,
		borderWidth: 1,
		borderRadius: opts?.control ? skin.controlRadius : skin.radius,
		boxShadow: opts?.glow && skin.glow ? skin.glow : undefined,
	};
}

/** Non-interactive skin-aware card. */
export function Surface({
	children,
	style,
	glow,
	control,
	opaque,
	...rest
}: ViewProps & { glow?: boolean; control?: boolean; opaque?: boolean }) {
	const surfaceStyle = useSurfaceStyle({ glow, control, opaque });
	return (
		<View {...rest} style={[surfaceStyle, style]}>
			{children}
		</View>
	);
}
