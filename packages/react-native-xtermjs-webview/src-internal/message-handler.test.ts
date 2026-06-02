import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleXtermJsWebViewMessage } from '../src/message-handler';

void test('XtermJsWebView message handling forwards tmuxScrollBatch pageStep', () => {
	const batches: unknown[] = [];
	const handled = handleXtermJsWebViewMessage({
		rawData: JSON.stringify({
			type: 'tmuxScrollBatch',
			direction: 'down',
			pages: 1,
			lines: 12,
			pageStep: 23,
			instanceId: 'instance-1',
			seq: 7,
			ts: 1234,
		}),
		onTmuxScrollBatch: (event) => batches.push(event),
	});

	assert.equal(handled, true);
	assert.deepEqual(batches, [
		{
			direction: 'down',
			pages: 1,
			lines: 12,
			pageStep: 23,
			instanceId: 'instance-1',
			seq: 7,
			ts: 1234,
		},
	]);
});

void test('packaged touch scroll artifacts include pageStep bridge fields', () => {
	const distIndex = readFileSync('dist/index.js', 'utf8');
	const distTypes = readFileSync('dist/index.d.ts', 'utf8');
	const distInternalHtml = readFileSync('dist-internal/index.html', 'utf8');

	assert.match(
		distIndex,
		/type:\\?"tmuxScrollBatch\\?",direction:[^\n]+pageStep:[^\n]+instanceId/,
	);
	assert.match(distIndex, /pageStep:\s*\w+\.pageStep/);
	assert.match(distTypes, /pageStep:\s*number/);
	assert.match(
		distInternalHtml,
		/type:"tmuxScrollBatch",direction:[^\n]+pageStep:[^\n]+instanceId/,
	);
});
