import type { GradientBlob } from './theme-skin';

/**
 * TEMP debug aid for telling the two themed-background renderers apart on device.
 * When {@link DEBUG_RENDERER_TINT} is true, each renderer repaints its gradient
 * blobs in a renderer-specific SOLID color (keeping each blob's position, size,
 * and motion), so you can tell at a glance which renderer is live — and whether
 * flipping `THEMED_BACKGROUND_RENDERER` in `ThemedBackground.tsx` actually took
 * effect (vs. a stale bundle):
 *   - RN-view renderer (`ThemedBackground.views`) → magenta
 *   - WebGPU renderer  (`ThemedBackground` ShaderView) → cyan
 *
 * Set `DEBUG_RENDERER_TINT = false` to restore the real per-theme blob colors.
 * Delete this file (and its two imports) once the renderer A/B is done.
 */
export const DEBUG_RENDERER_TINT = false;

/** RN-view renderer debug color (magenta). */
export const DEBUG_TINT_VIEWS = 'rgba(255,0,170,0.9)';
/** WebGPU renderer debug color (cyan). */
export const DEBUG_TINT_WGPU = 'rgba(0,210,255,0.9)';

/** Recolor a theme's blobs with a single debug color, preserving geometry. */
export function debugTintBlobs(blobs: GradientBlob[], color: string) {
	return blobs.map((blob) => ({ ...blob, color }));
}
