import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as messageHandler from '../src/message-handler';
import { parseXtermJsWebViewMessage } from '../src/message-handler';

void test('XtermJsWebView message parser keeps tmuxScrollBatch pageStep payload', () => {
	const message = parseXtermJsWebViewMessage(
		JSON.stringify({
			type: 'tmuxScrollBatch',
			direction: 'down',
			pages: 1,
			lines: 12,
			pageStep: 23,
			instanceId: 'instance-1',
			seq: 7,
			ts: 1234,
		}),
	);

	assert.deepEqual(message, {
		type: 'tmuxScrollBatch',
		direction: 'down',
		pages: 1,
		lines: 12,
		pageStep: 23,
		instanceId: 'instance-1',
		seq: 7,
		ts: 1234,
	});
});

void test('XtermJsWebView message helper does not expose component state routing API', () => {
	assert.equal('handleXtermJsWebViewMessage' in messageHandler, false);
});

void test('packaged touch scroll artifacts include pageStep bridge fields', () => {
	const distIndex = readFileSync('dist/index.js', 'utf8');
	const distTypes = readFileSync('dist/index.d.ts', 'utf8');
	const distMessageHandlerTypes = readFileSync(
		'dist/message-handler.d.ts',
		'utf8',
	);
	const distInternalHtml = readFileSync('dist-internal/index.html', 'utf8');

	assert.match(
		distIndex,
		/type:\\?"tmuxScrollBatch\\?",direction:[^\n]+pageStep:[^\n]+instanceId/,
	);
	assert.match(distIndex, /pageStep:\s*\w+\.pageStep/);
	assert.match(distTypes, /pageStep:\s*number/);
	assert.doesNotMatch(distIndex, /handleXtermJsWebViewMessage/);
	assert.doesNotMatch(distTypes, /handleXtermJsWebViewMessage/);
	assert.doesNotMatch(
		distMessageHandlerTypes,
		/handleXtermJsWebViewMessage/,
	);
	assert.match(
		distInternalHtml,
		/type:"tmuxScrollBatch",direction:[^\n]+pageStep:[^\n]+instanceId/,
	);
});
