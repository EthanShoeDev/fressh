import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import config from '../../app.config';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as {
	version: string;
	dependencies: { expo: string };
};

void test('runtimeVersion changes when native agent alert route ABI changes', () => {
	assert.equal(
		config.runtimeVersion,
		`${packageJson.version}-native-agent-alert-route-v1`,
	);
	assert.notEqual(config.runtimeVersion, packageJson.dependencies.expo);
});

void test('checked-in Android resources package the configured runtimeVersion', () => {
	const stringsXml = readFileSync(
		require.resolve('../../android/app/src/main/res/values/strings.xml'),
		'utf8',
	);

	assert.equal(
		stringsXml.includes(
			`<string name="expo_runtime_version">${config.runtimeVersion}</string>`,
		),
		true,
	);
});
