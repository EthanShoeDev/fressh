import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { mapTmuxScrollBatchMessage } from '../src/bridge';

void test('React Native wrapper forwards tmux scroll batch pageStep', () => {
	assert.deepEqual(
		mapTmuxScrollBatchMessage({
			type: 'tmuxScrollBatch',
			direction: 'up',
			pages: 2,
			lines: 3,
			pageStep: 24,
			instanceId: 'instance-1',
			seq: 7,
			ts: 123,
		}),
		{
			direction: 'up',
			pages: 2,
			lines: 3,
			pageStep: 24,
			instanceId: 'instance-1',
			seq: 7,
			ts: 123,
		},
	);
});

void test('touch scroll bridge source and generated HTML keep current contracts', () => {
	const packageRoot = process.cwd();
	const sourceFiles = [
		'src/bridge.ts',
		'src/index.tsx',
		'src-internal/touch-scroll-controller.ts',
	].map((path) => readFileSync(join(packageRoot, path), 'utf8'));
	const distHtml = readFileSync(
		join(packageRoot, 'dist-internal/index.html'),
		'utf8',
	);

	for (const content of [...sourceFiles, distHtml]) {
		assert.match(content, /pageStep/);
		assert.doesNotMatch(content, /emitExit/);
		assert.doesNotMatch(content, /scroll-input/);
		assert.doesNotMatch(content, /enterDelayMs/);
	}
});
