import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSkipInitialAutoConnectForUrl } from '../../src/lib/auto-connect-launch';

void test('e2e launch URL can suppress the initial auto-connect attempt', () => {
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=1',
		),
		true,
	);
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=true',
		),
		true,
	);
});

void test('normal launch URLs do not suppress initial auto-connect', () => {
	assert.equal(shouldSkipInitialAutoConnectForUrl(null), false);
	assert.equal(shouldSkipInitialAutoConnectForUrl('fressh:///'), false);
	assert.equal(
		shouldSkipInitialAutoConnectForUrl(
			'fressh:///?fresshE2eDisableAutoConnect=0',
		),
		false,
	);
	assert.equal(shouldSkipInitialAutoConnectForUrl('not a url'), false);
});
