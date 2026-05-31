import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildCreateGitHubIssueCommand,
	buildFeatureRequestSubmittedAlert,
	buildGitHubRepositoryTargetUrl,
	buildResolveGitHubRepositoryCommand,
	isGitHubRepositoryTarget,
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

void test('GitHub repository target helpers build Issues and Pull Requests URLs', () => {
	assert.equal(isGitHubRepositoryTarget('issues'), true);
	assert.equal(isGitHubRepositoryTarget('pulls'), true);
	assert.equal(isGitHubRepositoryTarget('repo'), false);

	assert.equal(
		buildGitHubRepositoryTargetUrl('mulyoved/fressh', 'issues'),
		'https://github.com/mulyoved/fressh/issues',
	);
	assert.equal(
		buildGitHubRepositoryTargetUrl('mulyoved/fressh', 'pulls'),
		'https://github.com/mulyoved/fressh/pulls',
	);
	assert.throws(
		() => buildGitHubRepositoryTargetUrl('not a repo', 'issues'),
		/Invalid GitHub repository/,
	);
});

void test('buildFeatureRequestSubmittedAlert formats title and message when issue URL has a number', () => {
	const alert = buildFeatureRequestSubmittedAlert({
		issueUrl: 'https://github.com/mulyoved/fressh/issues/123',
	});
	assert.equal(alert.title, 'Issue #123 Created');
	assert.equal(
		alert.message,
		'Your request has been created:\nhttps://github.com/mulyoved/fressh/issues/123',
	);
});

void test('buildFeatureRequestSubmittedAlert falls back to generic title when URL has no issue number', () => {
	const alert = buildFeatureRequestSubmittedAlert({
		issueUrl: 'https://github.com/mulyoved/fressh/pulls/123',
	});
	assert.equal(alert.title, 'Feature Request Submitted');
	assert.equal(
		alert.message,
		'Your request has been created:\nhttps://github.com/mulyoved/fressh/pulls/123',
	);
});

void test('buildFeatureRequestSubmittedAlert falls back to generic message when URL is null', () => {
	const alert = buildFeatureRequestSubmittedAlert({ issueUrl: null });
	assert.equal(alert.title, 'Feature Request Submitted');
	assert.equal(
		alert.message,
		'Your feature request has been submitted successfully.',
	);
});

void test('buildFeatureRequestSubmittedAlert tolerates trailing slash on issue URL', () => {
	const alert = buildFeatureRequestSubmittedAlert({
		issueUrl: 'https://github.com/owner/repo/issues/42/',
	});
	// Regex anchors at end so a trailing slash means no issue number is extracted.
	assert.equal(alert.title, 'Feature Request Submitted');
	assert.equal(
		alert.message,
		'Your request has been created:\nhttps://github.com/owner/repo/issues/42/',
	);
});
