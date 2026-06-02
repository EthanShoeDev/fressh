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
	 * The durable shell to render, from `startShell`. When unset, the view draws
	 * a cleared (background-only) frame; set it once the shell id is known.
	 */
	shellId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- input goes via the control plane (sendData) for v1
export interface TerminalMethods extends HybridViewMethods {}

export type Terminal = HybridView<TerminalProps, TerminalMethods>;
