import {
	buildSkillDiscoveryCommand,
	parseSkillDiscoveryResult,
	type DiscoveredSkill,
} from '@/lib/skill-discovery';
import type {
	SkillDiscoveryCache,
	SkillDiscoveryCacheRecord,
} from '@/lib/skill-discovery-cache';

export type SkillSelectorCommandRunner = (command: string) => Promise<string>;
export type SkillSelectorWorkspace = {
	panePath: string;
	projectRoot: string;
	projectName: string;
};
export type SkillSelectorWorkspaceResolver =
	() => Promise<SkillSelectorWorkspace>;

export type SkillSelectorProjectLoadResult = {
	source: 'cache' | 'remote';
	projectRoot: string;
	projectName: string;
	skills: DiscoveredSkill[];
	updatedAt: string | null;
	cacheRecord: SkillDiscoveryCacheRecord | null;
};

export async function loadSkillSelectorProject({
	cache,
	stableConnectionId,
	tmuxTarget,
	resolveWorkspace,
	runCommand,
	forceRefresh,
}: {
	cache: SkillDiscoveryCache;
	stableConnectionId: string;
	tmuxTarget: string;
	resolveWorkspace: SkillSelectorWorkspaceResolver;
	runCommand: SkillSelectorCommandRunner;
	forceRefresh: boolean;
}): Promise<SkillSelectorProjectLoadResult> {
	const workspace = await resolveWorkspace();
	const sourceParts = {
		stableConnectionId,
		tmuxTarget,
	};
	const cacheKeyParts = {
		...sourceParts,
		projectRoot: workspace.projectRoot,
	};

	if (!forceRefresh) {
		const cacheRecord = cache.read(cacheKeyParts);
		if (cacheRecord) {
			return {
				source: 'cache',
				projectRoot: cacheRecord.projectRoot,
				projectName: cacheRecord.projectName,
				skills: cacheRecord.skills,
				updatedAt: cacheRecord.updatedAt,
				cacheRecord,
			};
		}
	}

	const discoveryOutput = await runCommand(
		buildSkillDiscoveryCommand(workspace.projectRoot),
	);
	const discoveryResult = parseSkillDiscoveryResult(discoveryOutput);
	if (!discoveryResult) {
		throw new Error('Skill discovery returned invalid output.');
	}

	const cacheRecord = cache.write({
		...cacheKeyParts,
		projectName: workspace.projectName,
		skills: discoveryResult.skills,
	});

	return {
		source: 'remote',
		projectRoot: cacheRecord.projectRoot,
		projectName: cacheRecord.projectName,
		skills: cacheRecord.skills,
		updatedAt: cacheRecord.updatedAt,
		cacheRecord,
	};
}
