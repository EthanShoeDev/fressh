import type {
	HybridView,
	HybridViewMethods,
	HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The native terminal view (Nitro HybridView) — the RENDER PLANE (§10). It owns
 * the GL surface + render thread and draws the durable `Term` that `fressh-core`
 * keeps in its registry, looked up by `shellId`. No async / no promises cross the
 * cxx seam (§7 "Nitro is for the view only"); the byte stream never reaches JS.
 *
 * Lifecycle: the Kotlin view forwards its `Surface` + these props to the
 * render-plane C-ABI (`fressh_terminal_attach`/`set_shell`/`resize`/`draw`/
 * `destroy` in `shim-uniffi`). Changing `shellId` rebinds (instant reattach with
 * full scrollback). With no `shellId`, the view presents a cleared frame.
 */
export interface TerminalProps extends HybridViewProps {
	/** Path to a bundled monospace font file (no fontconfig on mobile, §6). */
	fontPath: string;
	/**
	 * Render config as a JSON blob, **already in physical px** (the JS `<Terminal
	 * config={...}>` wrapper scales logical pt by device pixel density and
	 * serializes here). Carries `fontSizePx`, `paddingXPx`/`paddingYPx`,
	 * `cursorStyle`, `colorScheme`, `boldIsBright`. Crossing the cxx seam as a
	 * single string keeps prop delivery on the proven scalar path. Changing it live
	 * reflows the shell — a bonus over desktop alacritty's restart-to-apply.
	 */
	configJson?: string;
	/**
	 * The durable shell to render, from `startShell`. When unset, the view draws
	 * a cleared (background-only) frame; set it once the shell id is known.
	 */
	shellId?: string;
}

// Intentionally empty: input goes via the control plane (sendData) for v1.
export interface TerminalMethods extends HybridViewMethods {}

export type Terminal = HybridView<TerminalProps, TerminalMethods>;
