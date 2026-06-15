import { createContext, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ShaderView } from 'react-native-effects';
import {
	type GradientBlob,
	skinHasCanvas,
	useThemeSkin,
} from '@/lib/theme-skin';
import { ViewScanlines, ViewThemedBackground } from './ThemedBackground.views';

/**
 * Which renderer paints the themed background:
 * - `'views'` — RN views + native `radial-gradient` (`ThemedBackground.views`).
 *   Composites behind BOTH tab bars, no GPU surface lifecycle. Default.
 * - `'wgpu'` — the WebGPU `ShaderView` renderer below. Seamless on JS tabs only
 *   (its surface can't sit behind the native tab bar's fragments) and carries
 *   the teardown/Dawn-patch complexity, but renders a true fragment shader.
 *
 * Both implementations live in the tree; flip this one constant to switch. See
 * docs/projects/themed-gradient-background.md for the trade-off.
 */
const THEMED_BACKGROUND_RENDERER: 'views' | 'wgpu' = 'views';

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

/** The active themed background. Both renderers share the `ThemedScreen` seam,
 *  so screens never know which one is mounted. */
export const ThemedBackground =
	THEMED_BACKGROUND_RENDERER === 'views'
		? ViewThemedBackground
		: WgpuThemedBackground;

/** The active standalone scanline overlay (Phosphor's JS tab bar). */
export const Scanlines =
	THEMED_BACKGROUND_RENDERER === 'views' ? ViewScanlines : WgpuScanlines;

/**
 * The per-theme screen canvas: soft radial gradient blobs + an optional CRT
 * scanline overlay, drawn by a WebGPU fragment shader (`react-native-effects`
 * ShaderView). Rendered absolutely behind screen content by `ThemedScreen`.
 * This is the ONLY file that touches the gradient renderer — swap the renderer
 * here without touching any screen.
 *
 * Why WebGPU and not Skia (the previous renderer): the ShaderView render loop
 * runs on a background worklet runtime, so aurora's continuous blob drift no
 * longer competes with the JS/main thread during tab switches — and static
 * themes pass `isStatic`, which renders one frame and stops the loop entirely.
 * On a device with no usable WebGPU adapter the canvas simply never presents,
 * so the theme gracefully degrades to its flat background color.
 *
 * The blob geometry/colors are theme constants, so they're baked into the
 * generated WGSL string (memoized per skin) instead of fed through ShaderView's
 * small uniform budget (2 colors / 8 floats).
 */
function WgpuThemedBackground() {
	const skin = useThemeSkin();
	const fragmentShader = useMemo(
		() =>
			skinHasCanvas(skin)
				? buildChromeShader({
						blobs: skin.blobs,
						animate: skin.animateBlobs,
						scanlines: skin.scanlines,
					})
				: null,
		[skin],
	);

	if (!fragmentShader) {
		return null;
	}

	return (
		<View pointerEvents='none' style={StyleSheet.absoluteFill}>
			<ShaderView
				fragmentShader={fragmentShader}
				isStatic={!skin.animateBlobs}
				transparent
				style={StyleSheet.absoluteFill}
			/>
		</View>
	);
}

/** Faint CRT scanline overlay on its own (Phosphor's JS tab bar). One static
 *  frame — the loop stops after presenting it. */
function WgpuScanlines() {
	return (
		<View pointerEvents='none' style={StyleSheet.absoluteFill}>
			<ShaderView
				fragmentShader={SCANLINES_SHADER}
				isStatic
				transparent
				style={StyleSheet.absoluteFill}
			/>
		</View>
	);
}

/** `rgba(r,g,b,a)` / `#rrggbb` → normalized RGBA floats for WGSL constants. */
function parseColor(color: string) {
	const rgba =
		/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
			color,
		);
	if (rgba) {
		return {
			r: Number(rgba[1]) / 255,
			g: Number(rgba[2]) / 255,
			b: Number(rgba[3]) / 255,
			a: rgba[4] === undefined ? 1 : Number(rgba[4]),
		};
	}
	const hex = /^#([0-9a-f]{6})$/i.exec(color);
	if (hex) {
		const n = Number.parseInt(hex[1] ?? '', 16);
		return {
			r: ((n >> 16) & 0xff) / 255,
			g: ((n >> 8) & 0xff) / 255,
			b: (n & 0xff) / 255,
			a: 1,
		};
	}
	throw new Error(`ThemedBackground: unsupported color format: ${color}`);
}

/** Format a JS number as a WGSL f32 literal (must contain a `.`). */
function f(n: number) {
	const s = String(n);
	return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/**
 * Generate the WGSL fragment shader for a theme's chrome. Blobs are composited
 * source-over in array order (later blobs on top), each fading linearly from
 * its color to transparent at radius `r` — the same math the Skia
 * RadialGradient fills produced. Output is premultiplied (the canvas is
 * configured `alphaMode: 'premultiplied'`).
 *
 * Coordinate notes: ShaderView's `ndc.y` points up (WebGPU), while the blob
 * fractions are y-down screen coords, hence the flip. `u.resolution` is in
 * physical pixels with `.w` = pixelRatio; the scanline spacing is specified in
 * device-independent px, so it divides by `.w`.
 */
function buildChromeShader(spec: {
	blobs: GradientBlob[];
	animate: boolean;
	scanlines: boolean;
}) {
	const blobLines = spec.blobs
		.map((blob, i) => {
			const c = parseColor(blob.color);
			const color = `vec4<f32>(${f(c.r)}, ${f(c.g)}, ${f(c.b)}, ${f(c.a)})`;
			// Aurora's drift: a slow lava-lamp wander (~18s/23s loops, ±10%/±8% of
			// the screen) plus a gentle radius pulse, phase-offset per blob so they
			// move independently. Tuned to be clearly alive within a few seconds of
			// looking, while staying slow enough to read as ambient.
			const center = spec.animate
				? `vec2<f32>((${f(blob.cx)} + sin(t / 2.8 + ${f(i)} * 2.1) * 0.10) * res.x, (${f(blob.cy)} + cos(t / 3.7 + ${f(i)} * 1.3) * 0.08) * res.y)`
				: `vec2<f32>(${f(blob.cx)} * res.x, ${f(blob.cy)} * res.y)`;
			const radius = spec.animate
				? `(${f(blob.r)} * (1.0 + sin(t / 3.1 + ${f(i)} * 2.6) * 0.06)) * maxDim`
				: `${f(blob.r)} * maxDim`;
			return `  acc = blobOver(p, ${center}, ${radius}, ${color}, acc);`;
		})
		.join('\n');

	return /* wgsl */ `
struct Uniforms {
  resolution: vec4<f32>,
  time:       vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
${
	spec.blobs.length > 0
		? `
// Source-over composite of one radial blob (premultiplied) onto acc.
fn blobOver(p: vec2<f32>, c: vec2<f32>, r: f32, color: vec4<f32>, acc: vec4<f32>) -> vec4<f32> {
  let fade = clamp(distance(p, c) / r, 0.0, 1.0);
  let a = color.a * (1.0 - fade);
  return vec4<f32>(color.rgb * a, a) + acc * (1.0 - a);
}
`
		: ''
}
@fragment
fn main(@location(0) ndc: vec2<f32>) -> @location(0) vec4<f32> {
  let uv = ndc * 0.5 + 0.5;
  let res = u.resolution.xy;
  let maxDim = max(res.x, res.y);
  let t = u.time.x;
  // y-down pixel coords to match the blob fractions (NDC y points up).
  let p = vec2<f32>(uv.x, 1.0 - uv.y) * res;
  var acc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
${blobLines}${
		spec.scanlines
			? `
  // Faint premultiplied-white horizontal lines every 3 device-independent px.
  let ydp = p.y / u.resolution.w;
  let sa = step(ydp % 3.0, 1.0) * 0.05;
  acc = vec4<f32>(sa, sa, sa, sa) + acc * (1.0 - sa);
`
			: ''
	}
  return acc;
}
`;
}

const SCANLINES_SHADER = buildChromeShader({
	blobs: [],
	animate: false,
	scanlines: true,
});
