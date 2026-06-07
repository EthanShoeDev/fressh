import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const detailSourcePath = join(process.cwd(), 'src/app/shell/detail.tsx');

function extractCreateWorkmuxControlChannelBlock(source: string): string {
	const callStart = source.indexOf('createWorkmuxControlChannel({');
	assert.notEqual(callStart, -1);

	let depth = 0;
	for (let index = callStart; index < source.length; index += 1) {
		const char = source[index];
		if (char === '(' || char === '{') depth += 1;
		if (char === ')' || char === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(callStart, index + 1);
		}
	}

	assert.fail('createWorkmuxControlChannel block was not closed');
}

function extractWorkmuxControlChannelMemoBlock(source: string): string {
	const memoStart = source.indexOf('const workmuxControlChannel = useMemo');
	assert.notEqual(memoStart, -1);
	const memoEnd = source.indexOf('const workmuxControlChannelRef', memoStart);
	assert.notEqual(memoEnd, -1);
	return source.slice(memoStart, memoEnd);
}

void describe('shell detail Workmux control channel wiring', () => {
	void test('routes shell scrollback through WorkmuxControlChannel instead of one-shot mdev scroll commands', () => {
		const source = readFileSync(detailSourcePath, 'utf8');

		assert.match(source, /createWorkmuxControlChannel/);
		assert.doesNotMatch(source, /executeWorkmuxScrollbackRemoteCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollEnterCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollExitCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollLineCommand/);
		assert.doesNotMatch(source, /buildWorkmuxAppScrollPageCommand/);
	});

	void test('cleans up scrollback executor before disposing the control channel', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const executorCleanupIndex = source.indexOf(
			'const cleanup = disposeTmuxScrollbackRuntimeStateForUiReset',
		);
		const sequencedDisposeIndex = source.indexOf(
			'disposeWorkmuxControlChannelAfterCleanup',
			executorCleanupIndex,
		);

		assert.notEqual(executorCleanupIndex, -1);
		assert.notEqual(sequencedDisposeIndex, -1);
		assert.ok(executorCleanupIndex < sequencedDisposeIndex);
		assert.doesNotMatch(
			source,
			/void workmuxControlChannel\.dispose\(\)\.catch/,
		);
	});

	void test('passes only the connection into WorkmuxControlChannel for Workmux control commands', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractCreateWorkmuxControlChannelBlock(source);

		assert.match(block, /connection:\s*connection\s*\?\?\s*null/);
		assert.doesNotMatch(block, /runRemoteCommand/);
		assert.doesNotMatch(block, /executeRemoteCommand/);
	});

	void test('keeps WorkmuxControlChannel memo scoped to tmux target cleanup lifecycle', () => {
		const source = readFileSync(detailSourcePath, 'utf8');
		const block = extractWorkmuxControlChannelMemoBlock(source);

		assert.match(block, /\[\s*connection\s*,\s*normalizedTmuxTarget\s*\]/);
	});
});
