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

	return skills.filter((skill) => {
		const description = skill.description ?? '';
		return (
			skill.name.toLowerCase().includes(normalizedQuery) ||
			description.toLowerCase().includes(normalizedQuery)
		);
	});
}

export function buildSkillDiscoveryCommand(panePath: string): string {
	return `python3 - ${quoteShell(panePath)} <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]) / '.codex' / 'skills'
records = []
for skill_file in sorted(root.glob('*/SKILL.md')):
    try:
        content = skill_file.read_text(encoding='utf-8', errors='replace')
    except OSError:
        continue
    records.append({'path': str(skill_file), 'content': content})
print(json.dumps(records))
PY`;
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

	let name: string | null = null;
	let description: string | null = null;
	for (const line of match[1].split(/\r?\n/)) {
		const fieldMatch = line.match(/^\s*(name|description)\s*:\s*(.*?)\s*$/);
		if (!fieldMatch) continue;

		const value = parseYamlScalar(fieldMatch[2]);
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
