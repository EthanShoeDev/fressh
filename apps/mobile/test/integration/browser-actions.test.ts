import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_ACTION_ROWS,
	BROWSER_ACTION_URL_ROWS,
	isBrowserActionUrlRow,
} from '../../src/lib/browser-actions';

void test('browser action rows expose the approved order and URL editability', () => {
	assert.deepEqual(
		BROWSER_ACTION_ROWS.map((row) => row.id),
		[
			'diff',
			'github-issues',
			'github-pulls',
			'url-window',
			'url-dev-server',
			'url-storybook',
			'url-app',
		],
	);

	assert.deepEqual(
		BROWSER_ACTION_URL_ROWS.map((row) => row.slot),
		['window-url', 'dev-web-server-url', 'storybook-url', 'app-url'],
	);

	assert.equal(isBrowserActionUrlRow(BROWSER_ACTION_ROWS[0]!), false);
	assert.equal(isBrowserActionUrlRow(BROWSER_ACTION_ROWS[3]!), true);
});
