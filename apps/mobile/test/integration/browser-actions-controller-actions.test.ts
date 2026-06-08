import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBrowserActionsPanePath } from '../../src/lib/browser-actions-controller-actions';
import { HOST_BROWSER_NO_CONNECTION_MESSAGE } from '../../src/lib/host-browser-actions';
import { WORKMUX_APP_COMMAND_UPDATE_MESSAGE } from '../../src/lib/workmux-app-commands';

void test('browser actions preserve local no-connection errors while resolving Workmux app context', async () => {
	await assert.rejects(
		() =>
			resolveBrowserActionsPanePath({
				tmuxEnabled: true,
				tmuxTarget: 'main',
				runHostBrowserCommand: async () => {
					throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
				},
				runWorkmuxCommand: async () => {
					throw new Error(HOST_BROWSER_NO_CONNECTION_MESSAGE);
				},
				getErrorMessage: (error) =>
					error instanceof Error ? error.message : String(error),
			}),
		(error) => {
			assert.equal(error instanceof Error, true);
			assert.equal(
				(error as Error).message,
				HOST_BROWSER_NO_CONNECTION_MESSAGE,
			);
			assert.notEqual(
				(error as Error).message,
				WORKMUX_APP_COMMAND_UPDATE_MESSAGE,
			);
			return true;
		},
	);
});
