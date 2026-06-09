import {
	addFresshEventListener,
	FresshEvent_Tags,
} from '@fressh/react-native-terminal';
import { create } from 'zustand';
import type { GitStatus } from './git-status';
import { rootLogger } from './logger';

const logger = rootLogger.extend('TermSemantics');

/**
 * Per-shell semantic context lifted out of the byte stream by the native OSC
 * scanner (OSC 7 cwd + OSC 133/633 command lifecycle). This is THE canonical
 * per-shell store the "smart terminal" surfaces read — the context bar today, and
 * the git slice + AI prompt-builder as they land. Kept as its OWN store (not
 * folded into ssh-store) so the feature is a self-contained layer: it subscribes
 * to the event plane independently and touches nothing in the control-plane
 * view-model.
 *
 * See docs/projects/smart-terminal-surface.md (consumer/surface design) and
 * docs/projects/complete/terminal-semantic-events.md (the producing pipeline).
 */
export interface ShellContext {
	/** Latest cwd reported via OSC 7 / OSC 633;P;Cwd (absolute path). */
	cwd?: string;
	/** True between CommandStart and CommandFinished (a command is running). */
	running: boolean;
	/** Exit code of the most recent finished command (absent if shell omitted it). */
	lastExitCode?: number;
	/** Wall-clock duration of the most recent command, ms. */
	lastDurationMs?: number;
	/** Literal command line of the most recent command (OSC 633;E only — present
	 *  when fressh's auto-injected integration is active, absent for plain 133). */
	lastCommand?: string;
	/** How many commands have finished in this shell (cheap "did anything run?"). */
	commandCount: number;
	/** True once ANY OSC 7/133/633 event has been seen on this shell — i.e. shell
	 *  integration is actually live. Drives the context bar's active vs. waiting. */
	sawOsc: boolean;
	/** Newest-first, capped history of finished commands (for the details sheet). */
	recent: RecentCommand[];
	/** Git status of `cwd`, written by the git driver (out-of-band `exec` + parse).
	 *  Undefined when cwd isn't a repo / no git / not yet probed. Not an OSC signal,
	 *  so it's set via {@link setShellGit}, which does NOT flip `sawOsc`. */
	git?: GitStatus;
}

/** One finished command in the per-shell history. `command` is present only when
 *  the shell emitted OSC 633;E (fressh's injected integration). */
export interface RecentCommand {
	command?: string;
	exitCode?: number;
	durationMs?: number;
	atMs: number;
}

const RECENT_CAP = 12;

const EMPTY: ShellContext = {
	running: false,
	commandCount: 0,
	sawOsc: false,
	recent: [],
};

interface TerminalSemanticsStore {
	byShell: Record<string, ShellContext>;
}

const useTerminalSemanticsStore = create<TerminalSemanticsStore>(() => ({
	byShell: {},
}));

/** Subscribe to one shell's semantic context (undefined until a signal arrives). */
export function useShellContext(shellId: string | undefined) {
	return useTerminalSemanticsStore((s) =>
		shellId ? s.byShell[shellId] : undefined,
	);
}

/** Merge a partial update into one shell's context. Every OSC event implies the
 *  integration is live, so `sawOsc` is set on every patch from the listener. */
function patch(shellId: string, next: Partial<ShellContext>) {
	useTerminalSemanticsStore.setState((s) => {
		const prev = s.byShell[shellId] ?? EMPTY;
		return {
			byShell: { ...s.byShell, [shellId]: { ...prev, ...next, sawOsc: true } },
		};
	});
}

/** Set (or clear, with `undefined`) the git slice for a shell. Unlike {@link patch}
 *  this does NOT set `sawOsc` — git status comes from an out-of-band `exec`, not the
 *  byte stream, so it must not be mistaken for shell-integration liveness. No-ops if
 *  the shell has no context yet (git only fires once cwd arrived via OSC). */
export function setShellGit(shellId: string, git: GitStatus | undefined) {
	useTerminalSemanticsStore.setState((s) => {
		const prev = s.byShell[shellId];
		if (!prev) return s;
		return { byShell: { ...s.byShell, [shellId]: { ...prev, git } } };
	});
}

// One subscription on the shared event-plane fan-out. Only the OSC-derived tags
// are handled here; everything else (lifecycle, host-key) is ssh-store's job.
addFresshEventListener((event) => {
	switch (event.tag) {
		case FresshEvent_Tags.WorkingDirectoryChanged: {
			const { shellId, path } = event.inner;
			patch(shellId, { cwd: path });
			break;
		}
		case FresshEvent_Tags.PromptStart: {
			// Back at a prompt → no command running.
			patch(event.inner.shellId, { running: false });
			break;
		}
		case FresshEvent_Tags.CommandStart: {
			patch(event.inner.shellId, { running: true });
			break;
		}
		case FresshEvent_Tags.CommandText: {
			const { shellId, command } = event.inner;
			patch(shellId, { lastCommand: command });
			break;
		}
		case FresshEvent_Tags.CommandFinished: {
			const { shellId, exitCode, durationMs } = event.inner;
			const ms = durationMs === undefined ? undefined : Number(durationMs);
			const prev = useTerminalSemanticsStore.getState().byShell[shellId];
			// `lastCommand` was set by the preceding OSC 633;E for this command.
			const entry: RecentCommand = {
				command: prev?.lastCommand,
				exitCode,
				durationMs: ms,
				atMs: Date.now(),
			};
			patch(shellId, {
				running: false,
				lastExitCode: exitCode,
				lastDurationMs: ms,
				commandCount: (prev?.commandCount ?? 0) + 1,
				recent: [entry, ...(prev?.recent ?? [])].slice(0, RECENT_CAP),
			});
			break;
		}
		case FresshEvent_Tags.ShellClosed: {
			const { shellId } = event.inner;
			useTerminalSemanticsStore.setState((s) => {
				if (!(shellId in s.byShell)) return s;
				const { [shellId]: _omit, ...byShell } = s.byShell;
				logger.debug('clearing semantics for closed shell', shellId);
				return { byShell };
			});
			break;
		}
		default:
			break;
	}
});
