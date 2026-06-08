import {
	addFresshEventListener,
	FresshEvent_Tags,
} from '@fressh/react-native-terminal';
import { useMemo } from 'react';
import { create } from 'zustand';
import { rootLogger } from './logger';

const logger = rootLogger.extend('TermSemantics');

/**
 * Per-shell "semantic" state lifted out of the byte stream by the native OSC
 * scanner (OSC 7 cwd + OSC 133 command lifecycle). This is the JS consumer of
 * the semantic-events seam — the same per-shell context the git/AI features will
 * build on. Kept as its OWN store (not folded into ssh-store) so the feature is
 * a self-contained layer: it subscribes to the event plane independently and
 * touches nothing in the control-plane view-model.
 *
 * See docs/projects/terminal-semantic-events.md.
 */
export interface ShellSemantics {
	/** Latest cwd reported via OSC 7 (absolute path). */
	cwd?: string;
	/** True between CommandStart and CommandFinished (a command is running). */
	running: boolean;
	/** Exit code of the most recent finished command (absent if shell omitted it). */
	lastExitCode?: number;
	/** Wall-clock duration of the most recent command, ms. */
	lastDurationMs?: number;
	/** How many commands have finished in this shell (cheap "did anything run?"). */
	commandCount: number;
}

/** One recent semantic event, kept for the debug panel so the raw pipeline is
 *  visible even before any derived state is interesting. */
export interface SemanticLogEntry {
	id: number;
	shellId: string;
	tag: string;
	/** Compact human summary of the event payload. */
	summary: string;
	atMs: number;
}

const EMPTY: ShellSemantics = { running: false, commandCount: 0 };
const LOG_CAP = 40;

interface TerminalSemanticsStore {
	byShell: Record<string, ShellSemantics>;
	/** Newest-first ring buffer of recent events (all shells), capped. */
	log: SemanticLogEntry[];
}

export const useTerminalSemanticsStore = create<TerminalSemanticsStore>(
	() => ({ byShell: {}, log: [] }),
);

/** Subscribe to one shell's semantic state (undefined until a signal arrives). */
export function useShellSemantics(shellId: string | undefined) {
	return useTerminalSemanticsStore((s) =>
		shellId ? s.byShell[shellId] : undefined,
	);
}

/** Subscribe to the recent-event log for one shell (newest first).
 *  Selects the stable `log` reference, then filters in a memo — filtering INSIDE
 *  the zustand selector would return a fresh array every render and trip
 *  "getSnapshot should be cached" → an infinite re-render loop. */
export function useShellEventLog(shellId: string | undefined) {
	const log = useTerminalSemanticsStore((s) => s.log);
	return useMemo(
		() => (shellId ? log.filter((e) => e.shellId === shellId) : log),
		[log, shellId],
	);
}

let nextLogId = 1;

/** Merge a partial update into one shell's semantic state. */
function patch(shellId: string, next: Partial<ShellSemantics>) {
	useTerminalSemanticsStore.setState((s) => {
		const prev = s.byShell[shellId] ?? EMPTY;
		return { byShell: { ...s.byShell, [shellId]: { ...prev, ...next } } };
	});
}

/** Append an entry to the capped, newest-first event log. */
function pushLog(shellId: string, tag: string, summary: string) {
	useTerminalSemanticsStore.setState((s) => ({
		log: [
			{ id: nextLogId++, shellId, tag, summary, atMs: Date.now() },
			...s.log,
		].slice(0, LOG_CAP),
	}));
}

// One subscription on the shared event-plane fan-out. Only the OSC-derived tags
// are handled here; everything else (lifecycle, host-key) is ssh-store's job.
addFresshEventListener((event) => {
	switch (event.tag) {
		case FresshEvent_Tags.WorkingDirectoryChanged: {
			const { shellId, path } = event.inner;
			patch(shellId, { cwd: path });
			pushLog(shellId, 'cwd', path);
			break;
		}
		case FresshEvent_Tags.PromptStart: {
			// Back at a prompt → no command running.
			patch(event.inner.shellId, { running: false });
			pushLog(event.inner.shellId, 'prompt', 'A');
			break;
		}
		case FresshEvent_Tags.CommandStart: {
			patch(event.inner.shellId, { running: true });
			pushLog(event.inner.shellId, 'cmd-start', 'running');
			break;
		}
		case FresshEvent_Tags.CommandFinished: {
			const { shellId, exitCode, durationMs } = event.inner;
			const ms = durationMs === undefined ? undefined : Number(durationMs);
			const prev = useTerminalSemanticsStore.getState().byShell[shellId];
			patch(shellId, {
				running: false,
				lastExitCode: exitCode,
				lastDurationMs: ms,
				commandCount: (prev?.commandCount ?? 0) + 1,
			});
			pushLog(
				shellId,
				'cmd-done',
				`exit=${exitCode ?? '?'}${ms !== undefined ? ` ${ms}ms` : ''}`,
			);
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
