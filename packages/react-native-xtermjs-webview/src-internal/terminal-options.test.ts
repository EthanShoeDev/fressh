import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultXtermOptions } from '../src/terminal-options';

void test('default xterm options preserve LF cursor column for full-screen terminal apps', () => {
	assert.equal(createDefaultXtermOptions().convertEol, false);
});
