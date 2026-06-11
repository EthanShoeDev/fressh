import {
	addFresshEventListener,
	FresshEvent_Tags,
	type FresshEvent,
} from '@fressh/react-native-terminal';
import { useAtomValue } from '@effect/atom-react';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Match from 'effect/Match';
import * as Atom from 'effect/unstable/reactivity/Atom';
import { atomRegistry } from './atom-registry';
import type { GitStatus } from './git-status';
import { appRuntime } from './runtime';

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

/** Per-shell semantic contexts. `keepAlive`: the event plane writes this
 *  whether or not any screen currently subscribes. */
const byShellAtom = Atom.make<Record<string, ShellContext>>({}).pipe(
	Atom.keepAlive,
);

/** Fine-grained per-shell selection — `Object.is` dedupe means a subscriber
 *  only re-renders when ITS shell's context changes. */
const shellContextAtom = Atom.family((shellId: string) =>
	Atom.map(byShellAtom, (byShell) => byShell[shellId]),
);

/** Subscribe to one shell's semantic context (undefined until a signal arrives). */
export function useShellContext(shellId: string | undefined) {
	// '' is never a real shell id — a stable family key for "no shell yet".
	return useAtomValue(shellContextAtom(shellId ?? ''));
}

/** Imperative read of one shell's context (outside React) — the git driver's
 *  stream source. */
export function getShellContext(shellId: string) {
	return atomRegistry.get(byShellAtom)[shellId];
}

/** Subscribe to every semantic-context change (outside React). */
export function subscribeShellContexts(listener: () => void) {
	return atomRegistry.subscribe(byShellAtom, listener);
}

/** Merge a partial update into one shell's context. Every OSC event implies the
 *  integration is live, so `sawOsc` is set on every patch from the listener. */
function patch(shellId: string, next: Partial<ShellContext>) {
	atomRegistry.update(byShellAtom, (byShell) => {
		const prev = byShell[shellId] ?? EMPTY;
		return { ...byShell, [shellId]: { ...prev, ...next, sawOsc: true } };
	});
}

/** Set (or clear, with `undefined`) the git slice for a shell. Unlike {@link patch}
 *  this does NOT set `sawOsc` — git status comes from an out-of-band `exec`, not the
 *  byte stream, so it must not be mistaken for shell-integration liveness. No-ops if
 *  the shell has no context yet (git only fires once cwd arrived via OSC). */
export function setShellGit(shellId: string, git: GitStatus | undefined) {
	atomRegistry.update(byShellAtom, (byShell) => {
		const prev = byShell[shellId];
		if (!prev) return byShell;
		return { ...byShell, [shellId]: { ...prev, git } };
	});
}

const onSemanticEvent = Match.type<FresshEvent>().pipe(
	Match.discriminator('tag')(FresshEvent_Tags.WorkingDirectoryChanged, (event) =>
		Effect.sync(() => patch(event.inner.shellId, { cwd: event.inner.path })),
	),
	// Back at a prompt → no command running.
	Match.discriminator('tag')(FresshEvent_Tags.PromptStart, (event) =>
		Effect.sync(() => patch(event.inner.shellId, { running: false })),
	),
	Match.discriminator('tag')(FresshEvent_Tags.CommandStart, (event) =>
		Effect.sync(() => patch(event.inner.shellId, { running: true })),
	),
	Match.discriminator('tag')(FresshEvent_Tags.CommandText, (event) =>
		Effect.sync(() =>
			patch(event.inner.shellId, { lastCommand: event.inner.command }),
		),
	),
	Match.discriminator('tag')(
		FresshEvent_Tags.CommandFinished,
		Effect.fnUntraced(function* (event) {
			const { shellId, exitCode, durationMs } = event.inner;
			const ms = durationMs === undefined ? undefined : Number(durationMs);
			const prev = atomRegistry.get(byShellAtom)[shellId];
			// `lastCommand` was set by the preceding OSC 633;E for this command.
			const entry: RecentCommand = {
				command: prev?.lastCommand,
				exitCode,
				durationMs: ms,
				atMs: yield* Clock.currentTimeMillis,
			};
			yield* Effect.sync(() =>
				patch(shellId, {
					running: false,
					lastExitCode: exitCode,
					lastDurationMs: ms,
					commandCount: (prev?.commandCount ?? 0) + 1,
					recent: [entry, ...(prev?.recent ?? [])].slice(0, RECENT_CAP),
				}),
			);
		}),
	),
	Match.discriminator('tag')(
		FresshEvent_Tags.ShellClosed,
		Effect.fnUntraced(function* (event) {
			const { shellId } = event.inner;
			if (!(shellId in atomRegistry.get(byShellAtom))) {
				return;
			}
			yield* Effect.logDebug('clearing semantics for closed shell', shellId);
			yield* Effect.sync(() =>
				atomRegistry.update(byShellAtom, (byShell) => {
					const { [shellId]: _omit, ...rest } = byShell;
					return rest;
				}),
			);
		}),
	),
	Match.orElse(() => Effect.void),
);

// One subscription on the shared event-plane fan-out. Only the OSC-derived tags
// are handled here; everything else (lifecycle, host-key) is ssh-store's job.
addFresshEventListener((event) =>
	appRuntime.runSync(
		Effect.annotateLogs(onSemanticEvent(event), { module: 'TermSemantics' }),
	),
);
