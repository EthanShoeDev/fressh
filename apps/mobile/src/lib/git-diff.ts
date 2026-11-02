import * as Arr from 'effect/Array';
import * as Str from 'effect/String';

import { shellSingleQuote } from './git-status';

/**
 * Pure helpers for the diff route: build the out-of-band `git diff` command and
 * classify each unified-diff line for colouring. No React-Native / store imports,
 * mirroring git-status.ts — the I/O (runCommand) lives in the route component.
 *
 * See docs/projects/git-diff-integration.md (v2: diff route).
 */

/** Build `git diff` for one file. Tracked files diff the working tree against HEAD
 *  (staged + unstaged combined — the intuitive "what did I change here"). Untracked
 *  files have no HEAD blob, so diff against /dev/null via `--no-index` (which shows
 *  every line as added — and, like `diff(1)`, exits 1 when there IS a difference, so
 *  the caller must NOT gate on a zero exit for this path). */
export function gitDiffCommand(
  cwd: string,
  file: string,
  opts?: { untracked?: boolean },
) {
  const c = shellSingleQuote(cwd);
  const f = shellSingleQuote(file);
  return opts?.untracked === true
    ? `git -C ${c} diff --no-index -- /dev/null ${f}`
    : `git -C ${c} diff HEAD -- ${f}`;
}

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'context';

const META_PREFIXES = [
  'diff ',
  'index ',
  'new file',
  'deleted file',
  'similarity ',
  'rename ',
  'old mode',
  'new mode',
  'Binary files',
];

/** Classify a unified-diff line for colouring. Order matters: the `+++`/`---` file
 *  headers must be caught before the bare `+`/`-` add/remove lines. */
export function classifyDiffLine(line: string): DiffLineKind {
  const startsWith = (prefix: string) => Str.startsWith(prefix)(line);
  if (startsWith('@@')) return 'hunk';
  if (startsWith('+++') || startsWith('---')) return 'meta';
  if (Arr.some(META_PREFIXES, startsWith)) return 'meta';
  if (startsWith('+')) return 'add';
  if (startsWith('-')) return 'del';
  return 'context';
}
