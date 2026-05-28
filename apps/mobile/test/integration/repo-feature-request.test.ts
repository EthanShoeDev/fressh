import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildCreateGitHubIssueCommand,
	buildResolveGitHubRepositoryCommand,
	parseGitHubRepositoryRemoteUrl,
	parseGitHubRepositoryResolutionOutput,
} from '../../src/lib/repo-feature-request';

void test('parseGitHubRepositoryRemoteUrl extracts owner and repo from common GitHub remotes', () => {
	assert.equal(
		parseGitHubRepositoryRemoteUrl('git@github.com:mulyoved/skills.git'),
		'mulyoved/skills',
	);
	assert.equal(
		parseGitHubRepositoryRemoteUrl('ssh://git@github.com/mulyoved/fressh.git'),
		'mulyoved/fressh',
	);
	assert.equal(
		parseGitHubRepositoryRemoteUrl('https://github.com/cube-9/cube9'),
		'cube-9/cube9',
	);
	assert.equal(
		parseGitHubRepositoryRemoteUrl('https://github.com/cube-9/cube9.git'),
		'cube-9/cube9',
	);
	assert.equal(
		parseGitHubRepositoryRemoteUrl('https://gitlab.com/a/b.git'),
		null,
	);
});

void test('parseGitHubRepositoryResolutionOutput returns the final owner/repo line', () => {
	assert.equal(
		parseGitHubRepositoryResolutionOutput(
			'noise\nhttps://github.com/mulyoved/fressh.git\nmulyoved/skills\n',
		),
		'mulyoved/skills',
	);
	assert.equal(
		parseGitHubRepositoryResolutionOutput('git@github.com:mulyoved/skills.git'),
		'mulyoved/skills',
	);
	assert.equal(parseGitHubRepositoryResolutionOutput('not a repo'), null);
});

void test('repository feature request commands quote paths, descriptions, and repositories', () => {
	assert.equal(
		buildResolveGitHubRepositoryCommand("/tmp/repo with ' quote"),
		[
			"cd '/tmp/repo with '\\'' quote' || exit 1",
			"repo=''",
			'if command -v gh >/dev/null 2>&1; then',
			'  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)',
			'fi',
			'if [ -z "$repo" ]; then',
			'  repo=$(git remote get-url origin 2>/dev/null || true)',
			'fi',
			'printf \'%s\\n\' "$repo"',
		].join('\n'),
	);

	const createCommand = buildCreateGitHubIssueCommand({
		description: "It's broken",
		repository: 'mulyoved/skills',
	});
	assert.match(createCommand, /repository='mulyoved\/skills'/);
	assert.match(createCommand, /description='It'\\''s broken'/);
	assert.match(
		createCommand,
		/gh issue create --repo "\$repository" --title "Feature Request: \$title" --body "\$description"/,
	);
});
