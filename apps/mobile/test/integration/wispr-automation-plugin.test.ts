import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function extractAccessibilityServiceTemplate(pluginSource: string): string {
	const match = pluginSource.match(
		/const ACCESSIBILITY_SERVICE_KOTLIN = `([\s\S]*?)`;/,
	);
	assert.ok(match, 'ACCESSIBILITY_SERVICE_KOTLIN template exists');
	const template = match[1];
	if (template === undefined) {
		throw new Error('ACCESSIBILITY_SERVICE_KOTLIN template body exists');
	}
	return template;
}

void test('Wispr automation only taps a live Wispr control', async () => {
	const pluginSource = await readFile(
		new URL('../../plugins/with-wispr-automation.ts', import.meta.url).pathname,
		'utf8',
	);
	const serviceTemplate = extractAccessibilityServiceTemplate(pluginSource);

	assert.doesNotMatch(serviceTemplate, /KEY_LAST_X/);
	assert.doesNotMatch(serviceTemplate, /KEY_LAST_Y/);
	assert.doesNotMatch(serviceTemplate, /fallbackX/);
	assert.doesNotMatch(serviceTemplate, /fallbackY/);
	assert.match(serviceTemplate, /val target = findWisprClickableCenter\(\)/);
	assert.doesNotMatch(serviceTemplate, /tapWisprStopControl/);
	assert.doesNotMatch(serviceTemplate, /label\.contains\("done"\)/);
	assert.doesNotMatch(serviceTemplate, /label\.contains\("check"\)/);
});

void test('Wispr accessibility service describes its gesture capability', async () => {
	const pluginSource = await readFile(
		new URL('../../plugins/with-wispr-automation.ts', import.meta.url).pathname,
		'utf8',
	);

	assert.match(pluginSource, /find the Wispr Flow control/);
	assert.match(pluginSource, /perform a tap gesture/);
	assert.doesNotMatch(pluginSource, /Lets Fressh/);
});
