import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_ACTION_ROWS,
	BROWSER_ACTION_URL_ROWS,
	getBrowserActionPressIntent,
	isBrowserActionUrlRow,
	type BrowserActionMenuMode,
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

void test('browser action press intent keeps static rows as open actions in every mode', () => {
	const modes: readonly BrowserActionMenuMode[] = ['open', 'set'];

	for (const mode of modes) {
		assert.deepEqual(
			getBrowserActionPressIntent(BROWSER_ACTION_ROWS[0]!, mode),
			{ type: 'open-diff' },
		);
		assert.deepEqual(
			getBrowserActionPressIntent(BROWSER_ACTION_ROWS[1]!, mode),
			{ type: 'open-github-issues' },
		);
		assert.deepEqual(
			getBrowserActionPressIntent(BROWSER_ACTION_ROWS[2]!, mode),
			{ type: 'open-github-pulls' },
		);
	}
});

void test('browser action press intent opens URL slots in open mode', () => {
	assert.deepEqual(
		BROWSER_ACTION_URL_ROWS.map((row) =>
			getBrowserActionPressIntent(row, 'open'),
		),
		[
			{ type: 'open-url-slot', slot: 'window-url' },
			{ type: 'open-url-slot', slot: 'dev-web-server-url' },
			{ type: 'open-url-slot', slot: 'storybook-url' },
			{ type: 'open-url-slot', slot: 'app-url' },
		],
	);
});

void test('browser action press intent edits URL slots in set mode', () => {
	assert.deepEqual(
		BROWSER_ACTION_URL_ROWS.map((row) =>
			getBrowserActionPressIntent(row, 'set'),
		),
		[
			{ type: 'edit-url-slot', slot: 'window-url' },
			{ type: 'edit-url-slot', slot: 'dev-web-server-url' },
			{ type: 'edit-url-slot', slot: 'storybook-url' },
			{ type: 'edit-url-slot', slot: 'app-url' },
		],
	);
});
