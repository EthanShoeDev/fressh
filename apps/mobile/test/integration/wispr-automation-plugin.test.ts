import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type * as ExpoConfigPlugins from 'expo/config-plugins';
import type withForegroundServiceType from '../../plugins/with-foreground-service';
import type withWisprAutomationType from '../../plugins/with-wispr-automation';

const require = createRequire(import.meta.url);
const { compileModsAsync } =
	require('expo/config-plugins') as typeof ExpoConfigPlugins;
const withForegroundService = require('../../plugins/with-foreground-service')
	.default as typeof withForegroundServiceType;
const withWisprAutomation = require('../../plugins/with-wispr-automation')
	.default as typeof withWisprAutomationType;

const MAIN_APPLICATION_FIXTURE = [
	'package com.finalapp.vibe2',
	'',
	'import com.facebook.react.PackageList',
	'',
	'class MainApplication {',
	'  fun getPackages() = PackageList(this).packages.apply {',
	'    // add(MyReactNativePackage())',
	'  }',
	'}',
].join('\n');

async function writeAndroidFixture(projectRoot: string) {
	await mkdir(
		path.join(projectRoot, 'android/app/src/main/java/com/finalapp/vibe2'),
		{ recursive: true },
	);
	await mkdir(path.join(projectRoot, 'android/app/src/main/res/values'), {
		recursive: true,
	});
	await writeFile(
		path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
		[
			'<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
			'  <application android:name=".MainApplication" />',
			'</manifest>',
		].join('\n'),
		'utf8',
	);
	await writeFile(
		path.join(
			projectRoot,
			'android/app/src/main/java/com/finalapp/vibe2/MainApplication.kt',
		),
		MAIN_APPLICATION_FIXTURE,
		'utf8',
	);
	await writeFile(
		path.join(projectRoot, 'android/app/src/main/res/values/strings.xml'),
		'<resources />',
		'utf8',
	);
}

async function generatedCombinedPackageSources() {
	const projectRoot = await mkdtemp(
		path.join(os.tmpdir(), 'fressh-wispr-plugin-'),
	);

	try {
		await writeAndroidFixture(projectRoot);

		const config = withWisprAutomation(
			withForegroundService({
				name: 'Fressh Test Fixture',
				slug: 'fressh-test-fixture',
				android: {
					package: 'com.finalapp.vibe2',
				},
			}),
		);

		await compileModsAsync(config, {
			projectRoot,
			platforms: ['android'],
		});

		const javaPath = path.join(
			projectRoot,
			'android/app/src/main/java/com/finalapp/vibe2',
		);
		return {
			foregroundPackage: await readFile(
				path.join(javaPath, 'ForegroundServicePackage.kt'),
				'utf8',
			),
			wisprPackage: await readFile(
				path.join(javaPath, 'WisprAutomationPackage.kt'),
				'utf8',
			),
			mainApplication: await readFile(
				path.join(javaPath, 'MainApplication.kt'),
				'utf8',
			),
		};
	} finally {
		await rm(projectRoot, { force: true, recursive: true });
	}
}

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

void test('Wispr plugin owns only Wispr native package registration', async () => {
	const { foregroundPackage, wisprPackage, mainApplication } =
		await generatedCombinedPackageSources();

	assert.match(foregroundPackage, /class ForegroundServicePackage/);
	assert.match(foregroundPackage, /ForegroundServiceModule\(reactContext\)/);
	assert.doesNotMatch(foregroundPackage, /WisprAutomationModule/);

	assert.match(wisprPackage, /class WisprAutomationPackage/);
	assert.match(wisprPackage, /WisprAutomationModule\(reactContext\)/);
	assert.doesNotMatch(wisprPackage, /ForegroundServiceModule/);

	assert.match(mainApplication, /add\(ForegroundServicePackage\(\)\)/);
	assert.match(mainApplication, /add\(WisprAutomationPackage\(\)\)/);
});
