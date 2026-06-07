#!/usr/bin/env node

import { readFile, stat } from 'fs/promises';
import path from 'path';
import process from 'process';
import { execFile as execFileCallback } from 'child_process';
import { parseArgs } from 'util';
import { promisify } from 'util';
import { pathToFileURL } from 'url';

import {
	canonicalizeReviewTarget,
	parseNormalizedReviewTarget,
} from './review-target.mjs';
import { CODE_REVIEW_GENERATED_PATHSPECS } from './review-artifact-pathspecs.mjs';
import { assertNoSensitiveReviewArtifacts } from './sensitive-review-artifacts.mjs';

const execFile = promisify(execFileCallback);
const MAX_UNTRACKED_FILE_BYTES = 200_000;
async function runGit(repoRoot, args) {
	const { stdout } = await execFile('git', args, {
		cwd: repoRoot,
		maxBuffer: 50 * 1024 * 1024,
	});
	return stdout;
}

function buildExcludedPathspecs({ excludeCodeReviewArtifacts = false } = {}) {
	return excludeCodeReviewArtifacts ? [...CODE_REVIEW_GENERATED_PATHSPECS] : [];
}

function appendPathspecArgs(args, excludedPathspecs = []) {
	if (excludedPathspecs.length === 0) {
		return args;
	}

	return [...args, '--', '.', ...excludedPathspecs];
}

function appendLiteralTargetPathspecArgs(
	args,
	literalTarget,
	excludedPathspecs = [],
) {
	return [...args, '--', literalTarget, ...excludedPathspecs];
}

function looksBinary(contents) {
	return contents.includes('\u0000');
}

function safeMarkdownFence(contents) {
	const longestBacktickRun = [...String(contents).matchAll(/`{3,}/g)].reduce(
		(longest, match) => Math.max(longest, match[0].length),
		2,
	);

	return '`'.repeat(longestBacktickRun + 1);
}

async function renderUntrackedFileSection(repoRoot, relativePath) {
	const absolutePath = path.join(repoRoot, relativePath);
	const pathStats = await stat(absolutePath);

	if (pathStats.isDirectory()) {
		return [
			`### File: ${relativePath}`,
			'',
			'(directory entry omitted from review input; inspect contained files separately if needed)',
			'',
		].join('\n');
	}

	const rawBuffer = await readFile(absolutePath);
	const truncated = rawBuffer.byteLength > MAX_UNTRACKED_FILE_BYTES;
	const buffer = truncated
		? rawBuffer.subarray(0, MAX_UNTRACKED_FILE_BYTES)
		: rawBuffer;
	const contents = buffer.toString('utf8');

	if (looksBinary(contents)) {
		return [
			`### File: ${relativePath}`,
			'',
			'(binary file omitted from review input)',
			'',
		].join('\n');
	}

	const fence = safeMarkdownFence(contents);

	return [
		`### File: ${relativePath}`,
		'',
		fence,
		contents,
		truncated ? '\n[truncated]\n' : '',
		fence,
		'',
	].join('\n');
}

async function buildUncommittedReviewInput(
	repoRoot,
	{ excludeCodeReviewArtifacts = false } = {},
) {
	const excludedPathspecs = buildExcludedPathspecs({
		excludeCodeReviewArtifacts,
	});
	const [unstagedDiff, stagedDiff, untrackedFiles] = await Promise.all([
		runGit(
			repoRoot,
			appendPathspecArgs(
				['diff', '--find-renames', '--binary'],
				excludedPathspecs,
			),
		),
		runGit(
			repoRoot,
			appendPathspecArgs(
				['diff', '--cached', '--find-renames', '--binary'],
				excludedPathspecs,
			),
		),
		runGit(
			repoRoot,
			appendPathspecArgs(
				['ls-files', '--others', '--exclude-standard', '-z'],
				excludedPathspecs,
			),
		).then((stdout) =>
			stdout
				.split('\0')
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	]);

	const lines = [
		'# Review Target',
		'',
		'Uncommitted changes (unstaged + staged + untracked files)',
		'',
		'## Unstaged Diff',
		'',
		unstagedDiff.trim() || '(none)',
		'',
		'## Staged Diff',
		'',
		stagedDiff.trim() || '(none)',
		'',
		'## Untracked Files',
		'',
	];

	if (untrackedFiles.length === 0) {
		lines.push('(none)', '');
		return `${lines.join('\n').trim()}\n`;
	}

	for (const relativePath of untrackedFiles) {
		lines.push(await renderUntrackedFileSection(repoRoot, relativePath));
	}

	return `${lines.join('\n').trim()}\n`;
}

async function buildLiteralReviewInput(
	repoRoot,
	literalTarget,
	{ excludeCodeReviewArtifacts = false } = {},
) {
	const excludedPathspecs = buildExcludedPathspecs({
		excludeCodeReviewArtifacts,
	});
	const [unstagedDiff, stagedDiff, untrackedFiles] = await Promise.all([
		runGit(
			repoRoot,
			appendLiteralTargetPathspecArgs(
				['diff', '--find-renames', '--binary'],
				literalTarget,
				excludedPathspecs,
			),
		),
		runGit(
			repoRoot,
			appendLiteralTargetPathspecArgs(
				['diff', '--cached', '--find-renames', '--binary'],
				literalTarget,
				excludedPathspecs,
			),
		),
		runGit(
			repoRoot,
			appendLiteralTargetPathspecArgs(
				['ls-files', '--others', '--exclude-standard', '-z'],
				literalTarget,
				excludedPathspecs,
			),
		).then((stdout) =>
			stdout
				.split('\0')
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	]);

	const lines = [
		'# Review Target',
		'',
		`Explicit path target: ${literalTarget}`,
		'',
		'## Unstaged Diff',
		'',
		unstagedDiff.trim() || '(none)',
		'',
		'## Staged Diff',
		'',
		stagedDiff.trim() || '(none)',
		'',
		'## Untracked Files',
		'',
	];

	if (untrackedFiles.length === 0) {
		lines.push('(none)', '');
		return `${lines.join('\n').trim()}\n`;
	}

	for (const relativePath of untrackedFiles) {
		lines.push(await renderUntrackedFileSection(repoRoot, relativePath));
	}

	return `${lines.join('\n').trim()}\n`;
}

async function buildUncommittedSupplementSections(
	repoRoot,
	{ excludeCodeReviewArtifacts = false } = {},
) {
	const excludedPathspecs = buildExcludedPathspecs({
		excludeCodeReviewArtifacts,
	});
	const [unstagedDiff, stagedDiff, untrackedFiles] = await Promise.all([
		runGit(
			repoRoot,
			appendPathspecArgs(
				['diff', '--find-renames', '--binary'],
				excludedPathspecs,
			),
		),
		runGit(
			repoRoot,
			appendPathspecArgs(
				['diff', '--cached', '--find-renames', '--binary'],
				excludedPathspecs,
			),
		),
		runGit(
			repoRoot,
			appendPathspecArgs(
				['ls-files', '--others', '--exclude-standard', '-z'],
				excludedPathspecs,
			),
		).then((stdout) =>
			stdout
				.split('\0')
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	]);

	if (
		!unstagedDiff.trim() &&
		!stagedDiff.trim() &&
		untrackedFiles.length === 0
	) {
		return [];
	}

	const lines = [
		'## Local Working Tree Overlay',
		'',
		"These current local edits are not part of the selected base/PR range, but they are present in the caller's working tree.",
		'',
		'### Unstaged Diff',
		'',
		unstagedDiff.trim() || '(none)',
		'',
		'### Staged Diff',
		'',
		stagedDiff.trim() || '(none)',
		'',
		'### Untracked Files',
		'',
	];

	if (untrackedFiles.length === 0) {
		lines.push('(none)', '');
		return lines;
	}

	for (const relativePath of untrackedFiles) {
		lines.push(await renderUntrackedFileSection(repoRoot, relativePath));
	}

	return lines;
}

async function buildCommitReviewInput(repoRoot, commit) {
	const diff = await runGit(repoRoot, [
		'show',
		'--find-renames',
		'--binary',
		'--format=medium',
		commit,
	]);

	return [
		'# Review Target',
		'',
		`Commit ${commit}`,
		'',
		'## Commit Diff',
		'',
		diff.trim() || '(none)',
		'',
	].join('\n');
}

async function buildBaseReviewInput(
	repoRoot,
	base,
	{ excludeCodeReviewArtifacts = false } = {},
) {
	const excludedPathspecs = buildExcludedPathspecs({
		excludeCodeReviewArtifacts,
	});
	const diff = await runGit(
		repoRoot,
		appendPathspecArgs(
			['diff', '--find-renames', '--binary', `${base}...HEAD`],
			excludedPathspecs,
		),
	);
	const overlayLines = await buildUncommittedSupplementSections(repoRoot, {
		excludeCodeReviewArtifacts,
	});

	return [
		'# Review Target',
		'',
		`Branch comparison against ${base}`,
		'',
		'## Branch Diff',
		'',
		diff.trim() || '(none)',
		'',
		...overlayLines,
	].join('\n');
}

async function buildPullRequestReviewInput(
	repoRoot,
	base,
	{ excludeCodeReviewArtifacts = false } = {},
) {
	const excludedPathspecs = buildExcludedPathspecs({
		excludeCodeReviewArtifacts,
	});
	const [diff, commits] = await Promise.all([
		runGit(
			repoRoot,
			appendPathspecArgs(
				['diff', '--find-renames', '--binary', `${base}...HEAD`],
				excludedPathspecs,
			),
		),
		runGit(repoRoot, ['log', '--oneline', `${base}..HEAD`]),
	]);
	const overlayLines = await buildUncommittedSupplementSections(repoRoot, {
		excludeCodeReviewArtifacts,
	});

	return [
		'# Review Target',
		'',
		`Pull request-style comparison against ${base}`,
		'',
		'## PR Commits',
		'',
		commits.trim() || '(none)',
		'',
		'## PR Diff',
		'',
		diff.trim() || '(none)',
		'',
		...overlayLines,
	].join('\n');
}

export async function prepareReviewInput({
	repoRoot = process.cwd(),
	reviewTarget = '--uncommitted',
	excludeCodeReviewArtifacts = false,
}) {
	await assertNoSensitiveReviewArtifacts({
		repoRoot,
		reviewTarget,
		excludeCodeReviewArtifacts,
	});
	const normalizedTarget = parseNormalizedReviewTarget(reviewTarget);
	let reviewInput;

	if (normalizedTarget.kind === 'uncommitted') {
		reviewInput = await buildUncommittedReviewInput(repoRoot, {
			excludeCodeReviewArtifacts,
		});
	} else if (normalizedTarget.kind === 'commit') {
		reviewInput = await buildCommitReviewInput(
			repoRoot,
			normalizedTarget.value,
		);
	} else if (normalizedTarget.kind === 'base') {
		reviewInput = await buildBaseReviewInput(repoRoot, normalizedTarget.value, {
			excludeCodeReviewArtifacts,
		});
	} else if (normalizedTarget.kind === 'pr') {
		reviewInput = await buildPullRequestReviewInput(
			repoRoot,
			normalizedTarget.value,
			{
				excludeCodeReviewArtifacts,
			},
		);
	} else if (normalizedTarget.kind === 'literal') {
		reviewInput = await buildLiteralReviewInput(
			repoRoot,
			normalizedTarget.value,
			{
				excludeCodeReviewArtifacts,
			},
		);
	} else {
		throw new Error(
			`Unsupported normalized review target: ${normalizedTarget.kind}`,
		);
	}

	return reviewInput;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
	const splitReviewTargetFlags = new Set([
		'--uncommitted',
		'--base',
		'--commit',
		'--pr',
	]);
	const splitReviewTargetFlagsWithValue = new Set([
		'--base',
		'--commit',
		'--pr',
	]);
	const normalizedArgv = [];
	for (let index = 0; index < argv.length; index += 1) {
		const currentArg = argv[index];
		const nextArg = argv[index + 1];
		if (
			currentArg === '--review-target' &&
			typeof nextArg === 'string' &&
			splitReviewTargetFlags.has(nextArg)
		) {
			if (splitReviewTargetFlagsWithValue.has(nextArg)) {
				const targetValue = argv[index + 2];
				if (typeof targetValue !== 'string' || targetValue.startsWith('-')) {
					throw new Error(
						`Split ${nextArg} review target requires a following value`,
					);
				}
				normalizedArgv.push(`--review-target=${nextArg} ${targetValue}`);
				index += 2;
			} else {
				normalizedArgv.push(`--review-target=${nextArg}`);
				index += 1;
			}
			continue;
		}
		normalizedArgv.push(currentArg);
	}

	const { values } = parseArgs({
		args: normalizedArgv,
		strict: true,
		allowPositionals: false,
		options: {
			'repo-root': { type: 'string' },
			'review-target': { type: 'string' },
			'exclude-code-review-artifacts': { type: 'boolean' },
			help: { type: 'boolean' },
		},
	});

	return {
		help: values.help ?? false,
		repoRoot: values['repo-root'] ?? process.cwd(),
		reviewTarget: canonicalizeReviewTarget(
			values['review-target'] ?? '--uncommitted',
		),
		excludeCodeReviewArtifacts:
			values['exclude-code-review-artifacts'] ?? false,
	};
}

function printUsage() {
	process.stdout.write(
		[
			'Usage:',
			'  node .agents/skills/code-review/scripts/prepare-review-input.mjs --repo-root <path> [--review-target --uncommitted|--base <branch>|--pr <base>|--commit <sha>] [--exclude-code-review-artifacts]',
			'',
		].join('\n'),
	);
}

async function main(argv = process.argv.slice(2)) {
	const options = parseCliArgs(argv);

	if (options.help) {
		printUsage();
		return;
	}

	process.stdout.write(await prepareReviewInput(options));
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exit(1);
	});
}
