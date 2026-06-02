import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	handleTmuxScrollBatchBridgeMessage,
	mapTmuxScrollBatchMessage,
} from '../src/bridge';

void test('tmux scroll batch mapper strips only bridge message type', () => {
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

void test('XtermJsWebView onMessage tmuxScrollBatch branch forwards pageStep', () => {
	const events: unknown[] = [];

	assert.equal(
		handleTmuxScrollBatchBridgeMessage(
			{
				type: 'tmuxScrollBatch',
				direction: 'down',
				pages: 1,
				lines: 5,
				pageStep: 32,
				instanceId: 'instance-2',
				seq: 9,
				ts: 456,
			},
			(event) => events.push(event),
		),
		true,
	);

	assert.deepEqual(events, [
		{
			direction: 'down',
			pages: 1,
			lines: 5,
			pageStep: 32,
			instanceId: 'instance-2',
			seq: 9,
			ts: 456,
		},
	]);
});

void test('public dist artifacts keep the published touch scroll bridge contract', () => {
	const packageRoot = process.cwd();
	const artifacts = [
		'dist/index.js',
		'dist/index.d.ts',
		'dist/bridge.d.ts',
		'dist-internal/index.html',
	].map((path) => ({
			path,
			content: readFileSync(join(packageRoot, path), 'utf8'),
		}));
	const removedContracts = [
		/emitExit/,
		/enterDelayMs/,
		/prefixKey/,
		/copyModeKey/,
		/cancelKey/,
		/exitKey/,
		/['"]typing['"]\s*\|\s*['"]scroll['"]/,
	];

	for (const { path, content } of artifacts) {
		if (path === 'dist/index.d.ts') {
			assert.match(content, /onTmuxScrollBatch\?: \(event: TmuxScrollBatchEvent\)/);
			assert.match(
				content,
				/export type \{ TmuxScrollBatchEvent, TouchScrollConfig \}/,
			);
		} else {
			assert.match(content, /pageStep/);
		}
		for (const removedContract of removedContracts) {
			assert.doesNotMatch(content, removedContract);
		}
	}
});
