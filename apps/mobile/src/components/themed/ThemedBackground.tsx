import {
	Canvas,
	Fill,
	RadialGradient,
	Shader,
	Skia,
	useClock,
	vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { useThemeSkin, type GradientBlob } from '@/lib/theme-skin';

/**
 * The per-theme screen canvas: soft radial gradient blobs + an optional CRT
 * scanline overlay, all drawn with Skia. Rendered absolutely behind screen
 * content by `ThemedScreen`. This is the ONLY file that touches the gradient
 * renderer — swap Skia here for expo-linear-gradient/svg without touching any
 * screen.
 */
export function ThemedBackground() {
	const skin = useThemeSkin();
	const { width, height } = useWindowDimensions();

	if (skin.blobs.length === 0 && !skin.scanlines) {
		return null;
	}

	return (
		<View pointerEvents='none' style={StyleSheet.absoluteFill}>
			<Canvas style={StyleSheet.absoluteFill}>
				{skin.blobs.map((blob, i) =>
					skin.animateBlobs ? (
						<AnimatedBlob key={i} blob={blob} w={width} h={height} index={i} />
					) : (
						<StaticBlob key={i} blob={blob} w={width} h={height} />
					),
				)}
				{skin.scanlines ? <Scanlines /> : null}
			</Canvas>
		</View>
	);
}

/** rgba(r,g,b,a) → rgba(r,g,b,0) so the blob fades to transparent (no dark halo). */
function fadeOut(color: string) {
	return color.replace(/,\s*[\d.]+\s*\)\s*$/, ', 0)');
}

function blobGeometry(blob: GradientBlob, w: number, h: number) {
	return {
		cx: w * blob.cx,
		cy: h * blob.cy,
		r: Math.max(w, h) * blob.r,
		colors: [blob.color, fadeOut(blob.color)],
	};
}

function StaticBlob({
	blob,
	w,
	h,
}: {
	blob: GradientBlob;
	w: number;
	h: number;
}) {
	const g = blobGeometry(blob, w, h);
	return (
		<Fill>
			<RadialGradient c={vec(g.cx, g.cy)} r={g.r} colors={g.colors} />
		</Fill>
	);
}

function AnimatedBlob({
	blob,
	w,
	h,
	index,
}: {
	blob: GradientBlob;
	w: number;
	h: number;
	index: number;
}) {
	const g = blobGeometry(blob, w, h);
	const clock = useClock();
	const center = useDerivedValue(() => {
		const t = clock.value;
		return vec(
			g.cx + Math.sin(t / 4200 + index) * w * 0.05,
			g.cy + Math.cos(t / 5300 + index) * h * 0.035,
		);
	});
	return (
		<Fill>
			<RadialGradient c={center} r={g.r} colors={g.colors} />
		</Fill>
	);
}

// Faint premultiplied-white horizontal scanlines every 3 device-independent px.
const SCANLINE_SKSL = `
half4 main(float2 xy) {
  float a = step(mod(xy.y, 3.0), 1.0) * 0.05;
  return half4(a, a, a, a);
}`;

function Scanlines() {
	const effect = useMemo(() => Skia.RuntimeEffect.Make(SCANLINE_SKSL), []);
	if (!effect) {
		return null;
	}
	return (
		<Fill>
			<Shader source={effect} />
		</Fill>
	);
}
