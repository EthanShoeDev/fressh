import { runCommand } from '@fressh/react-native-terminal';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Queue from 'effect/Queue';
import * as Stream from 'effect/Stream';
import React from 'react';
import { atomRegistry } from './atom-registry';
import { gitStatusCommand, parsePorcelainV2 } from './git-status';
import { appRuntime } from './runtime';
import { sshShellsAtom } from './ssh-store';
import {
	getShellContext,
	setShellGit,
	subscribeShellContexts,
} from './terminal-semantics';

/** Coalesce rapid `cd`s / back-to-back commands into one probe. */
const DEBOUNCE = '400 millis';

/** One probe request: everything needed to run `git status` out-of-band. */
interface ProbeTrigger {
	connectionId: string;
	cwd: string;
	/** Re-probe key: bumps on every CommandFinished. */
	commandCount: number;
}

/** Emits a trigger whenever the shell's cwd / finished-command count / backing
 *  connection changes (deduped), starting from the current state. Silent until
 *  the shell has both a cwd (OSC arrived) and a live connection. */
const probeTriggers = (shellId: string) =>
	Stream.callback<ProbeTrigger>((queue) =>
		Effect.gen(function* () {
			const emit = () => {
				const ctx = getShellContext(shellId);
				const connectionId =
					atomRegistry.get(sshShellsAtom)[shellId]?.connectionId;
				if (ctx?.cwd && connectionId) {
					Queue.offerUnsafe(queue, {
						connectionId,
						cwd: ctx.cwd,
						commandCount: ctx.commandCount,
					});
				}
			};
			emit();
			const unsubscribeSemantics = subscribeShellContexts(emit);
			const unsubscribeShells = atomRegistry.subscribe(sshShellsAtom, emit);
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					unsubscribeSemantics();
					unsubscribeShells();
				}),
			);
		}),
	).pipe(
		Stream.changesWith(
			(a, b) =>
				a.connectionId === b.connectionId &&
				a.cwd === b.cwd &&
				a.commandCount === b.commandCount,
		),
	);

const probeGitStatus = (shellId: string, trigger: ProbeTrigger) =>
	Effect.gen(function* () {
		const res = yield* Effect.tryPromise(() =>
			runCommand(trigger.connectionId, gitStatusCommand(trigger.cwd)),
		);
		// Exit code IS the repo detection: non-zero ⇒ not a repo / no git.
		yield* Effect.sync(() =>
			setShellGit(
				shellId,
				res.exitCode === 0 ? parsePorcelainV2(res.stdout) : undefined,
			),
		);
	}).pipe(
		Effect.catch((error) =>
			Effect.gen(function* () {
				yield* Effect.logDebug('git status probe failed', trigger.cwd, error);
				yield* Effect.sync(() => setShellGit(shellId, undefined));
			}),
		),
	);

/**
 * Drive the git slice of a shell's context. A debounced stream of probe
 * triggers (cwd via OSC 7/633, the finished-command count, the backing
 * connection) feeds a single out-of-band `git status` per quiet period, run on
 * a SIBLING exec channel (never the interactive PTY — that belongs to whatever
 * the user is running, e.g. a coding agent). `Stream.debounce` is the
 * coalescing; unmount interrupts the driver fiber, which cancels a pending
 * probe before it can write.
 *
 * Mounted by the ContextBar (one per visible shell), so git work only happens
 * while a terminal is on screen. See docs/projects/git-diff-integration.md.
 */
export function useGitStatusDriver(shellId: string | undefined) {
	React.useEffect(() => {
		if (!shellId) return;
		const fiber = appRuntime.runFork(
			probeTriggers(shellId).pipe(
				Stream.debounce(DEBOUNCE),
				Stream.runForEach((trigger) => probeGitStatus(shellId, trigger)),
				Effect.annotateLogs({ module: 'GitStatus' }),
			),
		);
		return () => {
			appRuntime.runFork(Fiber.interrupt(fiber));
		};
	}, [shellId]);
}
