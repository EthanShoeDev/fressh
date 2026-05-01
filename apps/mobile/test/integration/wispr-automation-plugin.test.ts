import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function extractAccessibilityServiceTemplate(pluginSource: string): string {
	const match = pluginSource.match(
		/const ACCESSIBILITY_SERVICE_KOTLIN = `([\s\S]*?)`;/,
	);
	assert.ok(match, 'ACCESSIBILITY_SERVICE_KOTLIN template exists');
	return match[1];
}

void test('Wispr automation cached bubble coordinates are versioned', async () => {
	const pluginSource = await readFile(
		new URL('../../plugins/with-wispr-automation.ts', import.meta.url),
		'utf8',
	);
	const serviceTemplate = extractAccessibilityServiceTemplate(pluginSource);

	assert.match(serviceTemplate, /private const val CACHE_VERSION = \d+/);
	assert.match(serviceTemplate, /KEY_LAST_CACHE_VERSION/);
	assert.match(
		serviceTemplate,
		/putInt\(KEY_LAST_CACHE_VERSION, CACHE_VERSION\)/,
	);
	assert.match(
		serviceTemplate,
		/val fallbackIsCurrent =\s*prefs\.getInt\(KEY_LAST_CACHE_VERSION, -1\) == CACHE_VERSION/,
	);
	assert.match(
		serviceTemplate,
		/val target = nodeCenter \?: if \(\s*fallbackIsCurrent &&\s*fallbackX >= 0f &&\s*fallbackY >= 0f\s*\)/,
	);
	assert.doesNotMatch(serviceTemplate, /tapWisprStopControl/);
	assert.doesNotMatch(serviceTemplate, /label\.contains\("done"\)/);
	assert.doesNotMatch(serviceTemplate, /label\.contains\("check"\)/);
});
