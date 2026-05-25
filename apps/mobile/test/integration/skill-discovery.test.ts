import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildSkillDiscoveryCommand,
	filterDiscoveredSkills,
	parseSkillDiscoveryOutput,
} from '../../src/lib/skill-discovery';

const discoveryPayload = JSON.stringify([
	{
		path: '/repo/.codex/skills/brainstorming/SKILL.md',
		content:
			'---\nname: brainstorming\ndescription: Explore requirements before implementation.\n---\n\n# Brainstorming\n',
	},
	{
		path: '/repo/.codex/skills/expo-deployment/SKILL.md',
		content:
			'---\ndescription: Deploy Expo apps to stores and web.\n---\n\n# Deployment\n',
	},
	{
		path: '/repo/.codex/skills/quoted/SKILL.md',
		content:
			'---\nname: "quoted-skill"\ndescription: "Quoted description"\n---\n',
	},
	{
		path: '/repo/.codex/skills/broken/SKILL.md',
		content: 'not frontmatter',
	},
	{
		path: '/repo/.agents/skills/ignored/SKILL.md',
		content: '---\nname: ignored\n---\n',
	},
]);

void test('parseSkillDiscoveryOutput reads skill frontmatter and falls back to directory names', () => {
	assert.deepEqual(parseSkillDiscoveryOutput(discoveryPayload), [
		{
			name: 'brainstorming',
			path: '/repo/.codex/skills/brainstorming/SKILL.md',
			description: 'Explore requirements before implementation.',
		},
		{
			name: 'broken',
			path: '/repo/.codex/skills/broken/SKILL.md',
			description: null,
		},
		{
			name: 'expo-deployment',
			path: '/repo/.codex/skills/expo-deployment/SKILL.md',
			description: 'Deploy Expo apps to stores and web.',
		},
		{
			name: 'quoted-skill',
			path: '/repo/.codex/skills/quoted/SKILL.md',
			description: 'Quoted description',
		},
	]);
});

void test('parseSkillDiscoveryOutput treats empty and malformed command output as no skills', () => {
	assert.deepEqual(parseSkillDiscoveryOutput(''), []);
	assert.deepEqual(parseSkillDiscoveryOutput('not json'), []);
	assert.deepEqual(
		parseSkillDiscoveryOutput(JSON.stringify({ path: 'nope' })),
		[],
	);
});

void test('filterDiscoveredSkills matches names and descriptions', () => {
	const skills = parseSkillDiscoveryOutput(discoveryPayload);

	assert.deepEqual(
		filterDiscoveredSkills(skills, 'expo').map((skill) => skill.name),
		['expo-deployment'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, 'requirements').map((skill) => skill.name),
		['brainstorming'],
	);
	assert.deepEqual(
		filterDiscoveredSkills(skills, '').map((skill) => skill.name),
		['brainstorming', 'broken', 'expo-deployment', 'quoted-skill'],
	);
});

void test('filterDiscoveredSkills ranks skill name matches before description matches', () => {
	const skills = [
		{
			name: 'aaa',
			path: '/repo/.codex/skills/aaa/SKILL.md',
			description: 'git helper',
		},
		{
			name: 'git-alias',
			path: '/repo/.codex/skills/git-alias/SKILL.md',
			description: 'Alias helper',
		},
		{
			name: 'parse-git',
			path: '/repo/.codex/skills/parse-git/SKILL.md',
			description: 'Parser helper',
		},
		{
			name: 'description-prefix',
			path: '/repo/.codex/skills/description-prefix/SKILL.md',
			description: 'git prefix helper',
		},
		{
			name: 'description-substring',
			path: '/repo/.codex/skills/description-substring/SKILL.md',
			description: 'helper for git',
		},
		{
			name: 'git',
			path: '/repo/.codex/skills/git/SKILL.md',
			description: 'Version control helper',
		},
		{
			name: 'aardvark-git',
			path: '/repo/.codex/skills/aardvark-git/SKILL.md',
			description: 'Name substring tie-breaker',
		},
	];

	assert.deepEqual(
		filterDiscoveredSkills(skills, 'git').map((skill) => skill.name),
		[
			'git',
			'git-alias',
			'aardvark-git',
			'parse-git',
			'aaa',
			'description-prefix',
			'description-substring',
		],
	);
});

void test('buildSkillDiscoveryCommand scopes discovery to repo-local codex skills', () => {
	const command = buildSkillDiscoveryCommand("/tmp/repo with ' quote");

	assert.match(command, /python3 -/);
	assert.match(command, /\.codex/);
	assert.match(command, /skills/);
	assert.match(command, /SKILL\.md/);
	assert.match(command, /errors='replace'/);
	assert.doesNotMatch(command, /\.agents/);
	assert.doesNotMatch(command, /plugins/);
	assert.match(command, /'\/tmp\/repo with '\\'' quote'/);
});
