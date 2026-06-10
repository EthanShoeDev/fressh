import { StyleSheet, Text, type TextStyle } from 'react-native';
import { useResolveClassNames } from 'uniwind';
import { resolveFont, useThemeSkin } from '@/lib/theme-skin';

type ThemedTextProps = React.ComponentProps<typeof Text> & {
	/** Use the theme's monospace face instead of its body sans. */
	mono?: boolean;
};

/**
 * Drop-in replacement for RN `Text` that applies the active theme's font. Custom
 * fonts ship one file per weight, so `font-bold`/`font-semibold` className can't
 * restyle a named font — this resolves the className's `fontWeight` and picks the
 * matching font file (`resolveFont`). On the default skin it falls back to the
 * system font (no fontFamily set). Use everywhere instead of `Text` so all copy
 * picks up the theme typeface.
 */
export function ThemedText({
	className,
	style,
	mono,
	...rest
}: ThemedTextProps) {
	const skin = useThemeSkin();
	const resolved = useResolveClassNames(className ?? '') as TextStyle;
	const flat = StyleSheet.flatten([resolved, style]);
	// Respect an explicit fontFamily (inline style or a `font-mono` class);
	// otherwise pick the theme's font for the resolved weight.
	const fontFamily =
		flat.fontFamily ?? resolveFont(skin, { mono, weight: flat.fontWeight });
	return (
		<Text
			className={className}
			style={[style, fontFamily ? { fontFamily } : null]}
			{...rest}
		/>
	);
}
