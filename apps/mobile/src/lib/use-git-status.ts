import { runCommand } from '@fressh/react-native-terminal';
import React from 'react';
import { gitStatusCommand, parsePorcelainV2 } from './git-status';
import { rootLogger } from './logger';
import { useSshStore } from './ssh-store';
import { setShellGit, useShellContext } from './terminal-semantics';

const logger = rootLogger.extend('GitStatus');

/** Coalesce rapid `cd`s / back-to-back commands into one probe. */
const DEBOUNCE_MS = 400;

/**
 * Drive the git slice of a shell's context. Watches the cwd (OSC 7/633) and the
 * finished-command count, and on either change fires a single out-of-band
 * `git status` on a SIBLING exec channel (never the interactive PTY — that belongs
 * to whatever the user is running, e.g. a coding agent). Detection is the exit code:
 * non-zero ⇒ not a repo / no git ⇒ the slice is cleared and the badge disappears.
 *
 * Mounted by the ContextBar (one per visible shell), so git work only happens while
 * a terminal is on screen. See docs/projects/git-diff-integration.md.
 */
export function useGitStatusDriver(shellId: string | undefined) {
	const ctx = useShellContext(shellId);
	const cwd = ctx?.cwd;
	// commandCount bumps on every CommandFinished → re-probe after each command
	// (the event-driven refresh: catches an agent's writes when it returns).
	const commandCount = ctx?.commandCount ?? 0;
	const connectionId = useSshStore((s) =>
		shellId ? s.shells[shellId]?.connectionId : undefined,
	);

	React.useEffect(() => {
		if (!shellId || !connectionId || !cwd) return;

		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const res = await runCommand(connectionId, gitStatusCommand(cwd));
				if (cancelled) return;
				// Exit code IS the repo detection: non-zero ⇒ not a repo / no git.
				setShellGit(
					shellId,
					res.exitCode === 0 ? parsePorcelainV2(res.stdout) : undefined,
				);
			} catch (error) {
				if (!cancelled) {
					logger.debug('git status probe failed', cwd, error);
					setShellGit(shellId, undefined);
				}
			}
		}, DEBOUNCE_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [shellId, connectionId, cwd, commandCount]);
}
