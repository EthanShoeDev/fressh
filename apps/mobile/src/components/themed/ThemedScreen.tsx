import { View, type ViewProps, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useThemeSkin } from '@/lib/theme-skin';
import { ThemedBackground } from './ThemedBackground';

const DEFAULT_EDGES: readonly Edge[] = ['top'];

/**
 * Screen scaffold that paints the active theme's canvas (gradient blobs +
 * scanlines) behind a safe-area content area. Use in place of a bare
 * `SafeAreaView` so every screen inherits the theme's background character.
 */
export function ThemedScreen({
	children,
	edges = DEFAULT_EDGES,
}: {
	children: React.ReactNode;
	edges?: readonly Edge[];
}) {
	const background = useCSSVariable('--color-background') as string;
	return (
		<View style={{ flex: 1, backgroundColor: background }}>
			<ThemedBackground />
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
