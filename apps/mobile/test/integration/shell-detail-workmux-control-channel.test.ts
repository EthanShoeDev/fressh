import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const detailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');

describe('shell detail Workmux control channel wiring', () => {
	test('routes shell scrollback through WorkmuxControlChannel instead of one-shot mdev scroll commands', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(source, /createWorkmuxControlChannel/);
		assert.doesNotMatch(source, /executeWorkmuxScrollbackRemoteCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollEnterCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollExitCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollLineCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollPageCommand/);
	});
});
