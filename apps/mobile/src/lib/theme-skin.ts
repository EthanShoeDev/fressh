import type { TextStyle } from 'react-native';
import { useUniwind } from 'uniwind';
import type { AppThemeName } from './theme';

/**
 * A soft radial "blob" of color for the screen canvas, positioned in fractional
 * screen coordinates so it scales to any device. Rendered by `ThemedBackground`
 * as a Skia RadialGradient (color → transparent).
 */
export type GradientBlob = {
	/** center x as fraction of screen width (0..1) */
	cx: number;
	/** center y as fraction of screen height (0..1) */
	cy: number;
	/** radius as fraction of the larger screen dimension */
	r: number;
	/** inner color (CSS rgba/hex); fades to transparent at the edge */
	color: string;
};

/**
 * A theme's *character* beyond its color tokens — shape, canvas treatment,
 * surface material, glow, and typographic voice. uniwind `@variant`s only swap
 * `--color-*`; this layer carries everything that makes Monolith feel brutalist
 * (sharp, edge-to-edge, ALL-CAPS mono) vs Aurora glassy (rounded, frosted,
 * gradient-washed). Driven off the *resolved* uniwind theme name.
 */
export type ThemeSkin = {
	/** Corner radius for cards/sheets (0 = sharp/brutalist). */
	radius: number;
	/** Corner radius for small controls (buttons, search, pills). */
	controlRadius: number;
	/** Soft radial gradient blobs painted on the screen canvas (Skia). */
	blobs: GradientBlob[];
	/** Animate the blobs with a slow drift (Aurora). */
	animateBlobs: boolean;
	/** Faint CRT scanline overlay (Phosphor). */
	scanlines: boolean;
	/** Translucent "glass" surfaces instead of opaque `--color-surface` (Aurora). */
	glass: boolean;
	/** `boxShadow` glow applied to active accents / status dots ('' = none). */
	glow: string;
	/** Casing for titles + emphasized labels. */
	textCase: 'upper' | 'lower' | 'none';
	/** Use a monospace face for headings/labels (terminal voice). */
	mono: boolean;
	/** List rows are full-bleed with hairline dividers, not floating cards. */
	edgeToEdge: boolean;
	/** letterSpacing for emphasized labels. */
	tracking: number;
	// Custom fonts ship one file per weight, so we carry the regular + bold
	// variants and `resolveFont()` picks the right file from the text's weight.
	/** Monospace font family (regular) for terminal-flavored labels/host strings. */
	monoFamily?: string;
	/** Monospace bold variant. */
	monoBold?: string;
	/** Primary body/text font (sans, regular). */
	bodyFamily?: string;
	/** Body bold variant. */
	bodyBold?: string;
	/** Body extra-bold variant (where the typeface has one). */
	bodyExtrabold?: string;

	// --- Screen-title (inline `ScreenHeader`) treatment ---
	/** Font size of the big inline route title. */
	titleSize: number;
	/** Weight of the route title (Monolith goes heavy/black). */
	titleWeight: TextStyle['fontWeight'];
	/** Whether the title itself uses the mono face (Phosphor) vs heavy display sans. */
	titleMono: boolean;
	/** letterSpacing for the title (negative = tight display, positive = airy). */
	titleTracking: number;
	/** Hairline rule under the header (Monolith). */
	headerRule: boolean;
	/** Neon text-shadow color behind the title (Aurora), else undefined. */
	titleGlow?: string;
	/** Explicit font for the big title (embeds its weight; overrides titleWeight). */
	titleFamily?: string;
};

// Font family names = the keys registered in `lib/fonts.ts` via `useFonts`.
const JETBRAINS = 'JetBrainsMono_400Regular';
const JETBRAINS_BOLD = 'JetBrainsMono_700Bold';
const SPACE_MONO = 'SpaceMono_400Regular';
const SPACE_MONO_BOLD = 'SpaceMono_700Bold';

const DEFAULT_SKIN: ThemeSkin = {
	radius: 16,
	controlRadius: 12,
	blobs: [],
	animateBlobs: false,
	scanlines: false,
	glass: false,
	glow: '',
	textCase: 'none',
	mono: false,
	edgeToEdge: false,
	tracking: 0,
	titleSize: 28,
	titleWeight: '800',
	titleMono: false,
	titleTracking: -0.3,
	headerRule: false,
};

const THEME_SKINS: Partial<Record<AppThemeName, ThemeSkin>> = {
	// Retro CRT: warm amber bloom + scanlines, mono + lowercase voice, snug radii.
	phosphor: {
		radius: 10,
		controlRadius: 8,
		blobs: [{ cx: 0.5, cy: -0.02, r: 0.75, color: 'rgba(255,180,84,0.11)' }],
		animateBlobs: false,
		scanlines: true,
		glass: false,
		glow: '0px 0px 24px rgba(255,180,84,0.30)',
		textCase: 'lower',
		mono: true,
		edgeToEdge: false,
		tracking: 0.3,
		monoFamily: JETBRAINS,
		monoBold: JETBRAINS_BOLD,
		bodyFamily: JETBRAINS,
		bodyBold: JETBRAINS_BOLD,
		titleSize: 27,
		titleWeight: '800',
		titleMono: true,
		titleTracking: 0.5,
		headerRule: false,
		titleFamily: JETBRAINS_BOLD,
	},
	// Calm dev-tool: soft indigo glow up top, generous rounding.
	graphite: {
		radius: 15,
		controlRadius: 12,
		blobs: [{ cx: 0.5, cy: -0.05, r: 0.65, color: 'rgba(124,140,255,0.16)' }],
		animateBlobs: false,
		scanlines: false,
		glass: false,
		glow: '0px 6px 20px rgba(99,102,241,0.40)',
		textCase: 'none',
		mono: false,
		edgeToEdge: false,
		tracking: 0,
		monoFamily: JETBRAINS,
		monoBold: JETBRAINS_BOLD,
		bodyFamily: 'InterTight_400Regular',
		bodyBold: 'InterTight_700Bold',
		bodyExtrabold: 'InterTight_800ExtraBold',
		titleSize: 28,
		titleWeight: '800',
		titleMono: false,
		titleTracking: -0.5,
		headerRule: false,
		titleFamily: 'InterTight_800ExtraBold',
	},
	// Frosted glass + neon: aurora gradient blobs (animated), translucent surfaces.
	aurora: {
		radius: 18,
		controlRadius: 14,
		// Lava-lamp aurora: large, saturated blobs that overlap and blend as they
		// drift (drift constants live in ThemedBackground.views + the WGSL). Four
		// blobs give the field more depth than three.
		blobs: [
			{ cx: 0.12, cy: 0.08, r: 0.72, color: 'rgba(45,230,198,0.45)' },
			{ cx: 0.9, cy: 0.84, r: 0.8, color: 'rgba(164,135,255,0.42)' },
			{ cx: 0.64, cy: 0.36, r: 0.62, color: 'rgba(255,122,198,0.34)' },
			{ cx: 0.3, cy: 0.7, r: 0.62, color: 'rgba(94,150,255,0.32)' },
		],
		animateBlobs: true,
		scanlines: false,
		glass: true,
		// Soft, tight teal bloom. Kept modest (was 30px/0.35) so the drop
		// shadow doesn't bleed onto adjacent cards/inputs — matches the design's
		// gentle accent glow rather than a heavy halo.
		glow: '0px 4px 16px rgba(45,230,198,0.22)',
		textCase: 'none',
		mono: false,
		edgeToEdge: false,
		tracking: 0,
		monoFamily: JETBRAINS,
		monoBold: JETBRAINS_BOLD,
		bodyFamily: 'SpaceGrotesk_400Regular',
		bodyBold: 'SpaceGrotesk_700Bold',
		titleSize: 28,
		titleWeight: '800',
		titleMono: false,
		titleTracking: -0.5,
		headerRule: false,
		titleGlow: 'rgba(45,230,198,0.45)',
		titleFamily: 'SpaceGrotesk_700Bold',
	},
	// Native: defer to the OS. No canvas (blobs/scanlines empty → ThemedBackground
	// renders nothing, the perf win), no glass/glow, system typography. The real
	// personality comes from the @expo/ui controls, not this skin. Keyed under
	// `native`; `native-light` resolves here too (see useThemeSkin).
	native: {
		radius: 10,
		controlRadius: 10,
		blobs: [],
		animateBlobs: false,
		scanlines: false,
		glass: false,
		glow: '',
		textCase: 'none',
		mono: false,
		edgeToEdge: false,
		tracking: 0,
		titleSize: 30,
		titleWeight: '700',
		titleMono: false,
		titleTracking: 0.35,
		headerRule: false,
	},
	// Brutalist: pure black, SHARP corners, edge-to-edge hairline grid, ALL-CAPS mono.
	monolith: {
		radius: 0,
		controlRadius: 0,
		blobs: [],
		animateBlobs: false,
		scanlines: false,
		glass: false,
		glow: '',
		textCase: 'upper',
		mono: true,
		edgeToEdge: true,
		tracking: 1.5,
		monoFamily: SPACE_MONO,
		monoBold: SPACE_MONO_BOLD,
		bodyFamily: SPACE_MONO,
		bodyBold: SPACE_MONO_BOLD,
		// Heavy Archivo Black display title — the design's signature big bold
		// ALL-CAPS heading. Space Mono stays for the small data labels/tags.
		titleSize: 34,
		titleWeight: '900',
		titleMono: false,
		titleTracking: -1,
		headerRule: true,
		titleFamily: 'Archivo_900Black',
	},
};

/** The active theme's skin (falls back to a neutral rounded default). The two
 *  Native variants (`native`/`native-light`) share one skin. */
export function useThemeSkin(): ThemeSkin {
	const { theme } = useUniwind();
	const key = theme === 'native-light' ? 'native' : theme;
	return THEME_SKINS[key as AppThemeName] ?? DEFAULT_SKIN;
}

/**
 * Whether a skin paints a screen canvas (gradient blobs and/or scanlines).
 * Single source of truth shared by `ThemedBackground` (whether to mount the
 * shader at all) and the JS tab bar layout (a canvas theme floats the bar OVER
 * the scene so the canvas runs under it; a flat theme keeps the bar in flow).
 */
export function skinHasCanvas(skin: ThemeSkin) {
	return skin.blobs.length > 0 || skin.scanlines;
}

/** Whether the system-following Native theme is active (either light or dark
 *  variant). The control/container layer branches on this to render @expo/ui. */
export function useIsNativeTheme() {
	const { theme } = useUniwind();
	return theme === 'native' || theme === 'native-light';
}

/**
 * Pick the right font *file* for a given weight, since custom fonts ship one
 * family per weight (`font-bold` className can't restyle a named font). Returns
 * undefined for the default skin (system font).
 */
export function resolveFont(
	skin: ThemeSkin,
	opts?: { mono?: boolean; weight?: TextStyle['fontWeight'] },
): string | undefined {
	const raw = opts?.weight;
	const w = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
	const weight = Number.isFinite(w) ? w : 400;
	if (opts?.mono) {
		return weight >= 600 ? (skin.monoBold ?? skin.monoFamily) : skin.monoFamily;
	}
	if (weight >= 800 && skin.bodyExtrabold) {
		return skin.bodyExtrabold;
	}
	return weight >= 600 ? (skin.bodyBold ?? skin.bodyFamily) : skin.bodyFamily;
}

/** Apply a skin's casing to a string (for titles/labels). */
export function applyCase(skin: ThemeSkin, text: string) {
	if (skin.textCase === 'upper') {
		return text.toUpperCase();
	}
	if (skin.textCase === 'lower') {
		return text.toLowerCase();
	}
	return text;
}
