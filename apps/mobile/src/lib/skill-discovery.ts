import { quoteShell } from '@/lib/host-browser-actions';

export type DiscoveredSkill = {
	name: string;
	path: string;
	description: string | null;
};

type SkillDiscoveryRecord = {
	path: string;
	content: string;
};

const skillPathPattern = /\/\.codex\/skills\/([^/]+)\/SKILL\.md$/;

export function parseSkillDiscoveryOutput(output: string): DiscoveredSkill[] {
	if (!output.trim()) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	return parsed
		.flatMap((record): DiscoveredSkill[] => {
			if (!isSkillDiscoveryRecord(record)) return [];

			const pathMatch = record.path.match(skillPathPattern);
			if (!pathMatch) return [];

			const fallbackName = pathMatch[1];
			if (!fallbackName) return [];
			const metadata = parseSkillFrontmatter(record.content);
			return [
				{
					name: metadata.name || fallbackName,
					path: record.path,
					description: metadata.description,
				},
			];
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function filterDiscoveredSkills(
	skills: readonly DiscoveredSkill[],
	query: string,
): DiscoveredSkill[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [...skills];

	return skills
		.map((skill) => ({
			skill,
			rank: getSkillSearchRank(skill, normalizedQuery),
		}))
		.filter(
			(match): match is { skill: DiscoveredSkill; rank: number } =>
				match.rank !== null,
		)
		.sort((a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name))
		.map((match) => match.skill);
}

function getSkillSearchRank(
	skill: DiscoveredSkill,
	normalizedQuery: string,
): number | null {
	const normalizedName = skill.name.toLowerCase();
	const normalizedDescription = (skill.description ?? '').toLowerCase();

	if (normalizedName === normalizedQuery) return 1;
	if (normalizedName.startsWith(normalizedQuery)) return 2;
	if (normalizedName.includes(normalizedQuery)) return 3;
	if (normalizedDescription.startsWith(normalizedQuery)) return 4;
	if (normalizedDescription.includes(normalizedQuery)) return 5;
	return null;
}

export function buildSkillDiscoveryCommand(panePath: string): string {
	const scriptBody = [
		'import json,pathlib,subprocess,sys',
		'start=pathlib.Path(sys.argv[1])',
		'try:',
		"    git=subprocess.run(['git','-C',str(start),'rev-parse','--show-toplevel'], text=True, capture_output=True)",
		'except OSError:',
		'    git=None',
		'base=pathlib.Path(git.stdout.strip()) if git and git.returncode == 0 and git.stdout.strip() else start',
		"root=base/'.codex'/'skills'",
		'records=[]',
		"for skill_file in sorted(root.glob('*/SKILL.md')):",
		"    try: content=skill_file.read_text(encoding='utf-8', errors='replace')",
		'    except OSError: continue',
		"    records.append({'path': str(skill_file), 'content': content})",
		'print(json.dumps(records))',
	].join('\n');
	const script = `exec(${JSON.stringify(scriptBody)})`;
	return `python3 -c ${quoteShell(script)} ${quoteShell(panePath)}`;
}

function isSkillDiscoveryRecord(value: unknown): value is SkillDiscoveryRecord {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as SkillDiscoveryRecord).path === 'string' &&
		typeof (value as SkillDiscoveryRecord).content === 'string'
	);
}

function parseSkillFrontmatter(content: string): {
	name: string | null;
	description: string | null;
} {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		return { name: null, description: null };
	}
	const frontmatter = match[1];
	if (!frontmatter) {
		return { name: null, description: null };
	}

	let name: string | null = null;
	let description: string | null = null;
	for (const line of frontmatter.split(/\r?\n/)) {
		const fieldMatch = line.match(/^\s*(name|description)\s*:\s*(.*?)\s*$/);
		if (!fieldMatch) continue;

		const rawValue = fieldMatch[2];
		if (rawValue === undefined) continue;
		const value = parseYamlScalar(rawValue);
		if (fieldMatch[1] === 'name') {
			name = value;
		} else {
			description = value;
		}
	}

	return { name, description };
}

function parseYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;

	const quote = trimmed[0];
	if (
		(quote === '"' || quote === "'") &&
		trimmed[trimmed.length - 1] === quote
	) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}
