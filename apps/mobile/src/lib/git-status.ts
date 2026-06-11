/**
 * Pure git-status layer for the smart terminal's git slice: build the out-of-band
 * command, and parse `git status --porcelain=v2 --branch -z` into a structured
 * `GitStatus`. NO React-Native / store imports live here on purpose — it's pure
 * data-in/data-out so it can be unit-tested with `bun test` (see git-status.test.ts).
 *
 * Detection is the EXIT CODE of the status command, not a separate probe: `git
 * status` exits non-zero (and fast) outside a repo, so the caller treats a non-zero
 * exit as "not a repo / no git" and renders nothing. See
 * docs/projects/git-diff-integration.md.
 */

import * as Match from 'effect/Match';

/** One changed path in `git status` porcelain v2. `x`/`y` are the index (staged)
 *  and worktree (unstaged) status chars; `.` means unchanged on that side. */
export interface GitFile {
	path: string;
	/** Index/staged status char (`.` = unchanged in index). */
	x: string;
	/** Worktree/unstaged status char (`.` = unchanged in worktree). */
	y: string;
	kind: 'changed' | 'untracked' | 'unmerged';
	/** Original path for a rename/copy (porcelain type-2 entries only). */
	origPath?: string;
}

/** Structured `git status --porcelain=v2 --branch` for one repo. */
export interface GitStatus {
	/** Current branch name; undefined when detached or unknown. */
	branch?: string;
	detached: boolean;
	/** Upstream ref (e.g. `origin/main`), if the branch tracks one. */
	upstream?: string;
	ahead: number;
	behind: number;
	/** Counts of tracked entries dirty in the index / worktree (a file can be both). */
	staged: number;
	unstaged: number;
	untracked: number;
	/** Unmerged (conflicted) entries. */
	conflicted: number;
	files: GitFile[];
}

/** Single-quote a path for a POSIX shell `exec` command (the SSH exec string is run
 *  through the user's login shell, so cwds with spaces / quotes must be quoted). */
export function shellSingleQuote(s: string) {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The out-of-band command: status of `cwd` in machine-readable, NUL-delimited form.
 *  `--branch` adds the head/upstream/ahead-behind header lines in the same shot. */
export function gitStatusCommand(cwd: string) {
	return `git -C ${shellSingleQuote(cwd)} status --porcelain=v2 --branch -z`;
}

/** Parse porcelain v2 `-z` output. The stream is NUL-delimited; rename/copy
 *  (type `2`) entries consume TWO fields (the entry, then the original path). */
export function parsePorcelainV2(stdout: string): GitStatus {
	const status: GitStatus = {
		detached: false,
		ahead: 0,
		behind: 0,
		staged: 0,
		unstaged: 0,
		untracked: 0,
		conflicted: 0,
		files: [],
	};

	const tokens = stdout.split('\0');
	let i = 0;
	while (i < tokens.length) {
		const tok = tokens[i];
		if (!tok) {
			i++;
			continue;
		}
		// Each branch returns how many tokens the entry consumed.
		i += Match.value(tok[0]).pipe(
			Match.when('#', () => {
				parseHeader(tok, status);
				return 1;
			}),
			Match.when('1', () => {
				const parts = tok.split(' ');
				addTracked(status, parts[1], parts.slice(8).join(' '));
				return 1;
			}),
			Match.when('2', () => {
				const parts = tok.split(' ');
				addTracked(status, parts[1], parts.slice(9).join(' '), tokens[i + 1]);
				return 2; // the next token is the rename's original path
			}),
			Match.when('u', () => {
				const parts = tok.split(' ');
				status.conflicted++;
				status.files.push({
					path: parts.slice(10).join(' '),
					x: parts[1]?.[0] ?? '?',
					y: parts[1]?.[1] ?? '?',
					kind: 'unmerged',
				});
				return 1;
			}),
			Match.when('?', () => {
				status.untracked++;
				status.files.push({
					path: tok.slice(2),
					x: '?',
					y: '?',
					kind: 'untracked',
				});
				return 1;
			}),
			// '!' ignored entries, or anything unrecognized — skip.
			Match.orElse(() => 1),
		);
	}
	return status;
}

function addTracked(
	status: GitStatus,
	xy: string | undefined,
	path: string,
	origPath?: string,
) {
	const x = xy?.[0] ?? '.';
	const y = xy?.[1] ?? '.';
	if (x !== '.') status.staged++;
	if (y !== '.') status.unstaged++;
	status.files.push({ path, x, y, kind: 'changed', origPath });
}

function parseHeader(tok: string, status: GitStatus) {
	// tok is e.g. "# branch.head main" / "# branch.ab +1 -2".
	const body = tok.slice(2);
	const sp = body.indexOf(' ');
	const key = sp === -1 ? body : body.slice(0, sp);
	const value = sp === -1 ? '' : body.slice(sp + 1);
	Match.value(key).pipe(
		Match.when('branch.head', () => {
			if (value === '(detached)') {
				status.detached = true;
			} else {
				status.branch = value;
			}
		}),
		Match.when('branch.upstream', () => {
			status.upstream = value;
		}),
		Match.when('branch.ab', () => {
			// "+<ahead> -<behind>"
			const [a, b] = value.split(' ');
			status.ahead = Number.parseInt(a ?? '', 10) || 0;
			status.behind = Math.abs(Number.parseInt(b ?? '', 10) || 0);
		}),
		Match.orElse(() => undefined),
	);
}
