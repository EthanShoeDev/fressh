import { useEffect } from 'react';
import {
	StyleSheet,
	useWindowDimensions,
	View,
	type ViewStyle,
} from 'react-native';
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withRepeat,
	withTiming,
} from 'react-native-reanimated';
import {
	type GradientBlob,
	skinHasCanvas,
	useThemeSkin,
} from '@/lib/theme-skin';

/**
 * RN-view implementation of the themed background — the non-WebGPU alternative
 * to the `ShaderView` renderer in `ThemedBackground.tsx`. Each gradient blob is
 * an ordinary `View` painted with a native `radial-gradient`
 * (`experimental_backgroundImage`, RN 0.85+); aurora's drift is a cheap
 * Reanimated transform on the UI thread.
 *
 * Why this exists alongside the WebGPU renderer: a `View` lives in the normal RN
 * view tree, so it composites behind BOTH the JS and the native (fragment-based)
 * tab bars, has no GPU surface to tear down on tab switch (no black flash, no
 * teardown crash, no Dawn patch), and needs no adapter. The WebGPU path stays in
 * the tree; flip `THEMED_BACKGROUND_RENDERER` in `ThemedBackground.tsx`.
 */
export function ViewThemedBackground() {
	const skin = useThemeSkin();
	if (!skinHasCanvas(skin)) {
		return null;
	}
	return (
		<View pointerEvents='none' style={StyleSheet.absoluteFill}>
			{skin.blobs.map((blob, i) => (
				<Blob
					// Blobs are a fixed per-theme list; index is a stable identity.
					key={i}
					blob={blob}
					index={i}
					animate={skin.animateBlobs}
				/>
			))}
			{skin.scanlines ? <ViewScanlines /> : null}
		</View>
	);
}

/** A single soft radial blob (color → transparent), optionally drifting. */
function Blob({
	blob,
	index,
	animate,
}: {
	blob: GradientBlob;
	index: number;
	animate: boolean;
}) {
	const { width: w, height: h } = useWindowDimensions();
	const maxDim = Math.max(w, h);
	const diameter = 2 * blob.r * maxDim;
	// Drift amplitudes mirror the WGSL renderer: ±10% width / ±8% height, ±6%
	// radius (here a scale), with ~18s/23s/19s periods phase-offset per blob.
	const ampX = 0.1 * w;
	const ampY = 0.08 * h;

	const base: ViewStyle = {
		position: 'absolute',
		left: blob.cx * w - diameter / 2,
		top: blob.cy * h - diameter / 2,
		width: diameter,
		height: diameter,
		// A circle filling the view: full blob color at the center fading to the
		// same color at zero alpha by the edge (matches the shader's linear fade).
		experimental_backgroundImage: [
			{
				type: 'radial-gradient',
				shape: 'circle',
				size: 'closest-side',
				position: { top: '50%', left: '50%' },
				colorStops: [
					{ color: blob.color, positions: ['0%'] },
					{ color: withAlpha(blob.color, 0), positions: ['100%'] },
				],
			},
		],
	};

	const x = useSharedValue(0);
	const y = useSharedValue(0);
	const s = useSharedValue(0);
	useEffect(() => {
		if (!animate) {
			return;
		}
		const ease = Easing.inOut(Easing.sin);
		// withRepeat(..., -1, true) ping-pongs, so the timing duration is half the
		// full period. Distinct durations + a per-blob delay desync the axes the
		// way the shader's different divisors + phase offsets did.
		x.value = withDelay(
			index * 1100,
			withRepeat(withTiming(1, { duration: 8800, easing: ease }), -1, true),
		);
		y.value = withDelay(
			index * 700,
			withRepeat(withTiming(1, { duration: 11600, easing: ease }), -1, true),
		);
		s.value = withDelay(
			index * 1300,
			withRepeat(withTiming(1, { duration: 9750, easing: ease }), -1, true),
		);
	}, [animate, index, x, y, s]);

	const animatedStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateX: (x.value - 0.5) * 2 * ampX },
			{ translateY: (y.value - 0.5) * 2 * ampY },
			{ scale: 1 + (s.value - 0.5) * 2 * 0.06 },
		],
	}));

	if (!animate) {
		return <View pointerEvents='none' style={base} />;
	}
	return <Animated.View pointerEvents='none' style={[base, animatedStyle]} />;
}

/** Faint CRT scanlines: a 1px line every 3dp, tiled with a native linear
 *  gradient (the RN-view analogue of the scanline shader). */
export function ViewScanlines() {
	return (
		<View
			pointerEvents='none'
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				experimental_backgroundImage: [
					{
						type: 'linear-gradient',
						direction: 'to bottom',
						colorStops: [
							{ color: 'rgba(255,255,255,0.05)', positions: ['0px'] },
							{ color: 'rgba(255,255,255,0.05)', positions: ['1px'] },
							{ color: 'transparent', positions: ['1px'] },
							{ color: 'transparent', positions: ['3px'] },
						],
					},
				],
				experimental_backgroundSize: [{ x: '100%', y: 3 }],
				experimental_backgroundRepeat: [{ x: 'repeat', y: 'repeat' }],
			}}
		/>
	);
}

/** Return `color` with its alpha replaced (keeps RGB). Accepts `rgb()/rgba()`
 *  and `#rrggbb`; anything else passes through unchanged. */
function withAlpha(color: string, alpha: number) {
	const rgba =
		/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(
			color,
		);
	if (rgba) {
		return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
	}
	const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
	if (hex) {
		const r = Number.parseInt(hex[1] ?? '0', 16);
		const g = Number.parseInt(hex[2] ?? '0', 16);
		const b = Number.parseInt(hex[3] ?? '0', 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return color;
}
