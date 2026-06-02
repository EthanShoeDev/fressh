import type {
	HybridView,
	HybridViewMethods,
	HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The native terminal view (Nitro HybridView). It is the RENDER PLANE only
 * (§10): it owns the GL surface + render thread and draws shared native
 * `Term` state. It carries NO async and NO promises across the cxx seam — all
 * async lives in the uniffi/craby control-plane shim. (§7 "Nitro is for the
 * view only".)
 *
 * The view attaches to a durable session by `shellId`: mount -> attach to the
 * existing `Term` in fressh-core's registry and draw current state instantly
 * (full scrollback, already parsed); unmount -> detach, `Term` keeps living.
 * This is the tmux reattach model (§9). No byte replay.
 */
export interface TerminalProps extends HybridViewProps {
	/** Durable session id (from `startShell`). The native view attaches to the
	 *  matching `Term` in the registry. */
	shellId: string;
	// TODO(scaffold): fontSize, theme/palette, cursorStyle, scrollback bound.
}

export interface TerminalMethods extends HybridViewMethods {
	// Imperative, SYNC methods (no promises cross the seam). Stubs:
	// TODO(scaffold): focus(): void; scrollToBottom(): void; paste(text: string): void;
	focus(): void;
}

export type Terminal = HybridView<TerminalProps, TerminalMethods>;
