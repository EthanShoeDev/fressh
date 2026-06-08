import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SKILL_DISCOVERY_CACHE_VERSION,
	buildSkillDiscoveryCacheKey,
	createSkillDiscoveryCache,
	type SkillDiscoveryCacheStorage,
} from '../../src/lib/skill-discovery-cache';

const keyParts = {
	stableConnectionId: 'connection.1',
	tmuxTarget: 'session:1.2',
	projectRoot: '/home/muly/fressh app',
};

function createMemoryStorage(initialEntries?: Record<string, string>) {
	const entries = new Map(Object.entries(initialEntries ?? {}));
	const storage: SkillDiscoveryCacheStorage = {
		getString: (key) => entries.get(key),
		set: (key, value) => {
			entries.set(key, value);
		},
		delete: (key) => {
			entries.delete(key);
		},
	};
	return { entries, storage };
}

void test('buildSkillDiscoveryCacheKey separates connection, tmux target, and project root', () => {
	assert.equal(
		buildSkillDiscoveryCacheKey(keyParts),
		[
			'skillDiscoveryCache',
			'v1',
			'connection%2E1',
			'session%3A1%2E2',
			'%2Fhome%2Fmuly%2Ffressh%20app',
		].join('.'),
	);

	assert.notEqual(
		buildSkillDiscoveryCacheKey({
			stableConnectionId: 'connection',
			tmuxTarget: '1.session',
			projectRoot: keyParts.projectRoot,
		}),
		buildSkillDiscoveryCacheKey({
			stableConnectionId: 'connection.1',
			tmuxTarget: 'session',
			projectRoot: keyParts.projectRoot,
		}),
	);
});

void test('write and read preserve cache records', () => {
	const { storage } = createMemoryStorage();
	const cache = createSkillDiscoveryCache({
		storage,
		now: () => '2026-05-26T12:00:00.000Z',
	});

	const written = cache.write({
		...keyParts,
		projectName: 'fressh app',
		skills: [
			{
				name: 'brainstorming',
				path: '/repo/.codex/skills/brainstorming/SKILL.md',
				description: 'Explore requirements.',
			},
			{
				name: 'missing-description',
				path: '/repo/.codex/skills/missing-description/SKILL.md',
				description: null,
			},
		],
	});

	assert.deepEqual(written, {
		version: SKILL_DISCOVERY_CACHE_VERSION,
		...keyParts,
		projectName: 'fressh app',
		skills: [
			{
				name: 'brainstorming',
				path: '/repo/.codex/skills/brainstorming/SKILL.md',
				description: 'Explore requirements.',
			},
			{
				name: 'missing-description',
				path: '/repo/.codex/skills/missing-description/SKILL.md',
				description: null,
			},
		],
		updatedAt: '2026-05-26T12:00:00.000Z',
	});
	assert.deepEqual(cache.read(keyParts), written);
});

void test('malformed records return null and are deleted from storage', () => {
	const key = buildSkillDiscoveryCacheKey(keyParts);
	const { entries, storage } = createMemoryStorage({
		[key]: JSON.stringify({
			version: SKILL_DISCOVERY_CACHE_VERSION,
			stableConnectionId: keyParts.stableConnectionId,
			tmuxTarget: keyParts.tmuxTarget,
			projectRoot: keyParts.projectRoot,
			projectName: 'fressh',
			skills: [{ name: 'broken', path: 42, description: null }],
			updatedAt: '2026-05-26T12:00:00.000Z',
		}),
	});
	const cache = createSkillDiscoveryCache({ storage });

	assert.equal(cache.read(keyParts), null);
	assert.equal(entries.has(key), false);
});
