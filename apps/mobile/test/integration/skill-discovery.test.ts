import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
	buildSkillDiscoveryCommand,
	filterDiscoveredSkills,
	parseSkillDiscoveryResult,
	type DiscoveredSkill,
} from '../../src/lib/skill-discovery';

const execFileAsync = promisify(execFile);

const discoveryRecords = [
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
		path: '/repo/.agents/skills/systematic-debugging/SKILL.md',
		content:
			'---\nname: systematic-debugging\ndescription: Debug with root cause evidence.\n---\n',
	},
];
const discoveryPayload = JSON.stringify({
	projectRoot: '/repo',
	records: discoveryRecords,
});

function parseSkills(output: string): DiscoveredSkill[] {
	return parseSkillDiscoveryResult(output)?.skills ?? [];
}

void test('parseSkillDiscoveryResult reads skill frontmatter and falls back to directory names', () => {
	assert.deepEqual(parseSkills(discoveryPayload), [
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
		{
			name: 'systematic-debugging',
			path: '/repo/.agents/skills/systematic-debugging/SKILL.md',
			description: 'Debug with root cause evidence.',
		},
	]);
});

void test('parseSkillDiscoveryResult rejects empty and malformed command output', () => {
	assert.equal(parseSkillDiscoveryResult(''), null);
	assert.equal(parseSkillDiscoveryResult('not json'), null);
	assert.equal(
		parseSkillDiscoveryResult(JSON.stringify({ path: 'nope' })),
		null,
	);
});

void test('parseSkillDiscoveryResult extracts framed JSON from noisy terminal output', () => {
	const noisyOutput = [
		'\u001b[?2004h(base) muly@dev-remote-machine:~$ python3 -c ...',
		'__FRESSH_SKILL_DISCOVERY_JSON_BEGIN__',
		discoveryPayload,
		'__FRESSH_SKILL_DISCOVERY_JSON_END__',
	].join('\n');

	assert.deepEqual(
		parseSkills(noisyOutput).map((skill) => skill.name),
		[
			'brainstorming',
			'broken',
			'expo-deployment',
			'quoted-skill',
			'systematic-debugging',
		],
	);
});

void test('parseSkillDiscoveryResult prefers framed JSON when noisy output starts with bracket prompt', () => {
	const noisyOutput = [
		'[muly@dev-remote-machine repo]$ python3 -c ...',
		'__FRESSH_SKILL_DISCOVERY_JSON_BEGIN__',
		discoveryPayload,
		'__FRESSH_SKILL_DISCOVERY_JSON_END__',
	].join('\n');

	assert.deepEqual(
		parseSkills(noisyOutput).map((skill) => skill.name),
		[
			'brainstorming',
			'broken',
			'expo-deployment',
			'quoted-skill',
			'systematic-debugging',
		],
	);
});

void test('parseSkillDiscoveryResult keeps the first local root when skill names duplicate', () => {
	const duplicatePayload = JSON.stringify({
		projectRoot: '/repo',
		records: [
			{
				path: '/repo/.agents/skills/brainstorming/SKILL.md',
				content:
					'---\nname: brainstorming\ndescription: Preferred pane-local skill.\n---\n',
			},
			{
				path: '/repo/.codex/skills/brainstorming/SKILL.md',
				content:
					'---\nname: brainstorming\ndescription: Duplicate root skill.\n---\n',
			},
		],
	});

	assert.deepEqual(parseSkills(duplicatePayload), [
		{
			name: 'brainstorming',
			path: '/repo/.agents/skills/brainstorming/SKILL.md',
			description: 'Preferred pane-local skill.',
		},
	]);
});

void test('filterDiscoveredSkills matches names and descriptions', () => {
	const skills = parseSkills(discoveryPayload);

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
		[
			'brainstorming',
			'broken',
			'expo-deployment',
			'quoted-skill',
			'systematic-debugging',
		],
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

void test('buildSkillDiscoveryCommand scopes discovery to repo-local skills', () => {
	const command = buildSkillDiscoveryCommand("/tmp/repo with ' quote");

	assert.match(command, /python3 -c/);
	assert.match(command, /\.codex/);
	assert.match(command, /\.agents/);
	assert.match(command, /skills/);
	assert.match(command, /SKILL\.md/);
	assert.match(command, /errors='\\''replace'\\''/);
	assert.doesNotMatch(command, /plugins/);
	assert.doesNotMatch(command, /<<'PY'/);
	assert.doesNotMatch(command, /\r?\n/);
	assert.match(command, /'\/tmp\/repo with '\\'' quote'/);
});

void test('buildSkillDiscoveryCommand executes and discovers repo-local skills', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-discovery-'));
	try {
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		const agentSkill = join(
			tempRepo,
			'.agents',
			'skills',
			'agent-demo',
			'SKILL.md',
		);
		const ignoredNestedSkill = join(
			tempRepo,
			'.codex',
			'skills',
			'nested',
			'deeper',
			'SKILL.md',
		);

		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, '.agents', 'skills', 'agent-demo'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, '.codex', 'skills', 'nested', 'deeper'), {
			recursive: true,
		});
		await writeFile(
			demoSkill,
			Buffer.concat([
				Buffer.from('---\nname: demo\ndescription: demo '),
				Buffer.from([0xff]),
				Buffer.from('\n---\n# Demo\n'),
			]),
		);
		await writeFile(
			agentSkill,
			'---\nname: agent-demo\ndescription: agent skill\n---\n',
		);
		await writeFile(
			ignoredNestedSkill,
			'---\nname: ignored-nested\ndescription: ignored\n---\n',
		);

		const { stdout } = await execFileAsync(
			'bash',
			['-lc', buildSkillDiscoveryCommand(tempRepo)],
			{ cwd: tempRepo },
		);

		const skills = parseSkills(stdout);
		assert.deepEqual(skills, [
			{
				name: 'agent-demo',
				path: agentSkill,
				description: 'agent skill',
			},
			{
				name: 'demo',
				path: demoSkill,
				description: 'demo \ufffd',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand resolves skills from the workspace root', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-discovery-workspace-'));
	try {
		const nestedCwd = join(tempRepo, 'apps', 'mobile');
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		await mkdir(nestedCwd, { recursive: true });
		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await writeFile(
			demoSkill,
			'---\nname: demo\ndescription: repo root\n---\n# Demo\n',
		);

		const { stdout } = await execFileAsync(
			'bash',
			['-lc', buildSkillDiscoveryCommand(tempRepo)],
			{ cwd: nestedCwd },
		);

		assert.deepEqual(parseSkills(stdout), [
			{
				name: 'demo',
				path: demoSkill,
				description: 'repo root',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand only discovers skills under the workspace root', async () => {
	const tempRepo = await mkdtemp(
		join(tmpdir(), 'skill-discovery-workspace-only-'),
	);
	try {
		const panePath = join(tempRepo, 'app', 'mobile');
		const rootSkill = join(tempRepo, '.codex', 'skills', 'root', 'SKILL.md');
		const intermediateSkill = join(
			tempRepo,
			'app',
			'.agents',
			'skills',
			'intermediate',
			'SKILL.md',
		);
		const paneSkill = join(
			panePath,
			'.agents',
			'skills',
			'duplicate',
			'SKILL.md',
		);
		const rootDuplicateSkill = join(
			tempRepo,
			'.codex',
			'skills',
			'duplicate',
			'SKILL.md',
		);
		await mkdir(join(tempRepo, '.codex', 'skills', 'root'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, 'app', '.agents', 'skills', 'intermediate'), {
			recursive: true,
		});
		await mkdir(join(panePath, '.agents', 'skills', 'duplicate'), {
			recursive: true,
		});
		await mkdir(join(tempRepo, '.codex', 'skills', 'duplicate'), {
			recursive: true,
		});
		await writeFile(
			rootSkill,
			'---\nname: root-skill\ndescription: root skill\n---\n',
		);
		await writeFile(
			intermediateSkill,
			'---\nname: intermediate-skill\ndescription: intermediate skill\n---\n',
		);
		await writeFile(
			paneSkill,
			'---\nname: duplicate-skill\ndescription: pane-local duplicate\n---\n',
		);
		await writeFile(
			rootDuplicateSkill,
			'---\nname: duplicate-skill\ndescription: root duplicate\n---\n',
		);

		const { stdout } = await execFileAsync(
			'bash',
			['-lc', buildSkillDiscoveryCommand(tempRepo)],
			{ cwd: panePath },
		);

		assert.deepEqual(parseSkills(stdout), [
			{
				name: 'duplicate-skill',
				path: rootDuplicateSkill,
				description: 'root duplicate',
			},
			{
				name: 'root-skill',
				path: rootSkill,
				description: 'root skill',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand does not require git', async () => {
	const tempRepo = await mkdtemp(join(tmpdir(), 'skill-discovery-no-git-'));
	const tempBin = await mkdtemp(join(tmpdir(), 'skill-discovery-bin-'));
	try {
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await writeFile(
			demoSkill,
			'---\nname: demo\ndescription: no git\n---\n# Demo\n',
		);

		await writeFile(
			join(tempBin, 'python3'),
			'#!/bin/sh\nexec /usr/bin/python3 "$@"\n',
			{
				mode: 0o755,
			},
		);

		await execFileAsync('/bin/bash', ['-c', '! command -v git'], {
			env: { ...process.env, PATH: tempBin },
		});

		const { stdout } = await execFileAsync(
			'/bin/bash',
			['-c', buildSkillDiscoveryCommand(tempRepo)],
			{ cwd: tempRepo, env: { ...process.env, PATH: tempBin } },
		);

		assert.deepEqual(parseSkills(stdout), [
			{
				name: 'demo',
				path: demoSkill,
				description: 'no git',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
		await rm(tempBin, { recursive: true, force: true });
	}
});

void test('buildSkillDiscoveryCommand works with side-channel completion suffix', async () => {
	const tempRepo = await mkdtemp(
		join(tmpdir(), 'skill-discovery-side-channel-'),
	);
	try {
		const demoSkill = join(tempRepo, '.codex', 'skills', 'demo', 'SKILL.md');
		await mkdir(join(tempRepo, '.codex', 'skills', 'demo'), {
			recursive: true,
		});
		await writeFile(
			demoSkill,
			'---\nname: demo\ndescription: side channel\n---\n# Demo\n',
		);

		const marker = '__SIDE_CHANNEL_TEST_DONE__';
		const command = `${buildSkillDiscoveryCommand(tempRepo)}; __EC__=$?; echo "${marker}"; echo "EXIT_CODE:$__EC__"`;
		const { stdout } = await execFileAsync('bash', ['-lc', command], {
			cwd: tempRepo,
		});
		const sideChannelOutput = `${command}\n${stdout}`;
		const sideChannelLines = sideChannelOutput.trim().split(/\r?\n/);
		const markerLineIndex = sideChannelLines.findIndex(
			(line) => line.trim() === marker,
		);
		const cleanOutput = sideChannelLines
			.slice(1, markerLineIndex)
			.join('\n')
			.trim();
		const exitCode = sideChannelOutput.match(/EXIT_CODE:(\d+)/)?.[0];

		assert.ok(markerLineIndex > 0);
		assert.equal(exitCode, 'EXIT_CODE:0');
		assert.deepEqual(parseSkills(cleanOutput), [
			{
				name: 'demo',
				path: demoSkill,
				description: 'side channel',
			},
		]);
	} finally {
		await rm(tempRepo, { recursive: true, force: true });
	}
});
