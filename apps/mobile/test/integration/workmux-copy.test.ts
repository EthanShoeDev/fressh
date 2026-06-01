import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const detailSource = readFileSync(
	path.join(repoRoot, 'apps/mobile/src/app/shell/detail.tsx'),
	'utf8',
);

void test('attach error copy uses Workmux language', () => {
	assert.match(detailSource, /Workmux session not found/);
	assert.match(detailSource, /attach to Workmux session/);
	assert.doesNotMatch(detailSource, /Tmux session not found/);
	assert.doesNotMatch(detailSource, /attach to tmux session/);
});
