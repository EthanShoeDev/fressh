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

const skillDiscoveryJsonBeginMarker = '__FRESSH_SKILL_DISCOVERY_JSON_BEGIN__';
const skillDiscoveryJsonEndMarker = '__FRESSH_SKILL_DISCOVERY_JSON_END__';
const skillPathPattern = /\/\.(?:agents|codex)\/skills\/([^/]+)\/SKILL\.md$/;

export function parseSkillDiscoveryOutput(output: string): DiscoveredSkill[] {
	const jsonPayload = extractSkillDiscoveryJsonPayload(output);
	if (!jsonPayload) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonPayload);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const skills: DiscoveredSkill[] = [];
	const seenNames = new Set<string>();
	for (const record of parsed) {
		if (!isSkillDiscoveryRecord(record)) continue;

		const pathMatch = record.path.match(skillPathPattern);
		if (!pathMatch) continue;

		const fallbackName = pathMatch[1];
		if (!fallbackName) continue;
		const metadata = parseSkillFrontmatter(record.content);
		const name = metadata.name || fallbackName;
		const nameKey = name.toLowerCase();
		if (seenNames.has(nameKey)) continue;
		seenNames.add(nameKey);
		skills.push({
			name,
			path: record.path,
			description: metadata.description,
		});
	}

	return skills.sort((a, b) => a.name.localeCompare(b.name));
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
		'start=start.resolve()',
		'base=base.resolve()',
		'candidates=[]',
		'current=start',
		'while True:',
		'    candidates.append(current)',
		'    if current == base or current.parent == current: break',
		'    current=current.parent',
		'if base not in candidates: candidates.append(base)',
		'roots=[]',
		'seen_roots=set()',
		'for candidate in candidates:',
		"    for root in [candidate/'.agents'/'skills',candidate/'.codex'/'skills']:",
		'        key=str(root)',
		'        if key in seen_roots: continue',
		'        seen_roots.add(key)',
		'        roots.append(root)',
		'records=[]',
		'seen_records=set()',
		'for root in roots:',
		"    for skill_file in sorted(root.glob('*/SKILL.md')):",
		'        record_key=str(skill_file)',
		'        if record_key in seen_records: continue',
		'        seen_records.add(record_key)',
		"        try: content=skill_file.read_text(encoding='utf-8', errors='replace')",
		'        except OSError: continue',
		"        records.append({'path': str(skill_file), 'content': content})",
		`print(${JSON.stringify(skillDiscoveryJsonBeginMarker)})`,
		'print(json.dumps(records))',
		`print(${JSON.stringify(skillDiscoveryJsonEndMarker)})`,
	].join('\n');
	const script = `exec(${JSON.stringify(scriptBody)})`;
	return `python3 -c ${quoteShell(script)} ${quoteShell(panePath)}`;
}

function extractSkillDiscoveryJsonPayload(output: string): string | null {
	const trimmed = output.trim();
	if (!trimmed) return null;

	const lines = output.split(/\r?\n/);
	const beginIndex = lines.findIndex(
		(line) => stripAnsi(line).trim() === skillDiscoveryJsonBeginMarker,
	);
	if (beginIndex < 0) return trimmed.startsWith('[') ? trimmed : null;
	const endIndex = lines.findIndex(
		(line, index) =>
			index > beginIndex &&
			stripAnsi(line).trim() === skillDiscoveryJsonEndMarker,
	);
	if (endIndex < 0) return null;

	const payload = lines
		.slice(beginIndex + 1, endIndex)
		.join('\n')
		.trim();
	return payload || null;
}

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
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
