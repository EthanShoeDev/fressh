import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkmuxAttachErrorCopy } from '../../src/lib/workmux-copy';

void test('attach error copy uses Workmux language', () => {
	assert.deepEqual(getWorkmuxAttachErrorCopy('main'), {
		title: 'Workmux session not found',
		body: 'We could not attach to Workmux session "main". Create it on the server and try again.',
	});
});
