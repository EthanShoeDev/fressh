import type {
	HybridView,
	HybridViewMethods,
	HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The native terminal view (Nitro HybridView) — the RENDER PLANE (§10). It owns
 * the GL surface + render thread and draws shared native `Term` state. No async
 * / no promises cross the cxx seam (§7 "Nitro is for the view only").
 *
 * PoC scope: the view renders a hardcoded demo `Term` from a bundled font.
 * `shellId` (attach to a durable session) + config come back with SSH.
 */
export interface TerminalProps extends HybridViewProps {
	/** Path to a bundled monospace font file (no fontconfig on mobile, §6). */
	fontPath: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no imperative methods yet
export interface TerminalMethods extends HybridViewMethods {}

export type Terminal = HybridView<TerminalProps, TerminalMethods>;
