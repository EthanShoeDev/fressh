import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
	withMainApplication,
} from 'expo/config-plugins';

const PERMISSIONS = [
	'android.permission.FOREGROUND_SERVICE',
	'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
	'android.permission.POST_NOTIFICATIONS',
	'android.permission.WAKE_LOCK',
];

const SERVICE_NAME = '.SshForegroundService';
const SPECIAL_USE_PROPERTY_NAME =
	'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';
const SPECIAL_USE_PROPERTY_VALUE =
	'Long-running user-visible SSH terminal session and agent status listener';

const JAVA_PACKAGE_RELATIVE_PATH = 'app/src/main/java/com/finalapp/vibe2';
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_TEMPLATE_SOURCE_PATH = path.join(
	PLUGIN_DIR,
	'foreground-service-android',
);
const FOREGROUND_SERVICE_PACKAGE_REGISTRATION =
	'add(ForegroundServicePackage())';

const FOREGROUND_SERVICE_PACKAGE_KOTLIN = `package com.finalapp.vibe2

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ForegroundServicePackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ) = listOf(
    ForegroundServiceModule(reactContext)
  )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`;

async function readAndroidTemplateSource(filename: string) {
	return fs.readFile(path.join(ANDROID_TEMPLATE_SOURCE_PATH, filename), 'utf8');
}

function findMatchingBrace(contents: string, openBraceIndex: number): number {
	let depth = 0;

	for (let index = openBraceIndex; index < contents.length; index += 1) {
		const char = contents[index];
		if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
}

function addForegroundServicePackageRegistration(contents: string): string {
	const packageListApply = 'PackageList(this).packages.apply {';
	const applyIndex = contents.indexOf(packageListApply);
	if (applyIndex === -1) {
		throw new Error(
			`Could not find ${packageListApply} in Android MainApplication.kt`,
		);
	}

	const openBraceIndex = contents.indexOf('{', applyIndex);
	const closeBraceIndex = findMatchingBrace(contents, openBraceIndex);
	if (closeBraceIndex === -1) {
		throw new Error(
			'Could not find PackageList(this).packages.apply block end in Android MainApplication.kt',
		);
	}

	const applyBlock = contents.slice(openBraceIndex + 1, closeBraceIndex);
	if (applyBlock.includes(FOREGROUND_SERVICE_PACKAGE_REGISTRATION)) {
		return contents;
	}

	const blockLines = applyBlock.split('\n');
	const indentedLine = blockLines.find((line) => line.trim().length > 0);
	const indent = indentedLine?.match(/^\s*/)?.[0] ?? '              ';
	const closeBraceLineStart = contents.lastIndexOf('\n', closeBraceIndex) + 1;

	return `${contents.slice(0, closeBraceLineStart)}${indent}${FOREGROUND_SERVICE_PACKAGE_REGISTRATION}\n${contents.slice(closeBraceLineStart)}`;
}

const withForegroundServicePackageRegistration: ConfigPlugin = (config) =>
	withMainApplication(config, (config) => {
		config.modResults.contents = addForegroundServicePackageRegistration(
			config.modResults.contents,
		);

		return config;
	});

const withForegroundServiceManifest: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		const manifest = config.modResults;

		AndroidConfig.Permissions.ensurePermissions(manifest, PERMISSIONS);

		const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
		app.service = app.service ?? [];
		type SshForegroundServiceAttributes = (typeof app.service)[number]['$'] & {
			'android:foregroundServiceType'?: 'specialUse';
			'android:stopWithTask'?: 'true' | 'false';
		};
		type SshForegroundService = (typeof app.service)[number] & {
			property?: {
				$: {
					'android:name': typeof SPECIAL_USE_PROPERTY_NAME;
					'android:value': typeof SPECIAL_USE_PROPERTY_VALUE;
				};
			}[];
		};
		const ensureSpecialUseProperty = (service: SshForegroundService) => {
			service.property = service.property ?? [];
			const existing = service.property.find(
				(property) => property.$['android:name'] === SPECIAL_USE_PROPERTY_NAME,
			);
			if (existing) {
				existing.$['android:value'] = SPECIAL_USE_PROPERTY_VALUE;
				return;
			}
			service.property.push({
				$: {
					'android:name': SPECIAL_USE_PROPERTY_NAME,
					'android:value': SPECIAL_USE_PROPERTY_VALUE,
				},
			});
		};
		const alreadyPresent = app.service.some(
			(service) => service.$['android:name'] === SERVICE_NAME,
		);
		if (alreadyPresent) {
			for (const service of app.service) {
				if (service.$['android:name'] === SERVICE_NAME) {
					(service.$ as SshForegroundServiceAttributes)[
						'android:foregroundServiceType'
					] = 'specialUse';
					(service.$ as SshForegroundServiceAttributes)[
						'android:stopWithTask'
					] = 'false';
					ensureSpecialUseProperty(service as SshForegroundService);
				}
			}
		} else {
			const service = {
				$: {
					'android:name': SERVICE_NAME,
					'android:exported': 'false',
					'android:foregroundServiceType': 'specialUse',
					'android:stopWithTask': 'false',
				} as SshForegroundServiceAttributes,
			} as SshForegroundService;
			ensureSpecialUseProperty(service);
			app.service.push(service);
		}

		return config;
	});

const withForegroundServiceNativeFiles: ConfigPlugin = (config) =>
	withDangerousMod(config, [
		'android',
		async (config) => {
			const javaPackagePath = path.join(
				config.modRequest.platformProjectRoot,
				JAVA_PACKAGE_RELATIVE_PATH,
			);
			await fs.mkdir(javaPackagePath, { recursive: true });

			for (const filename of [
				'SshForegroundService.kt',
				'ForegroundServiceModule.kt',
			] as const) {
				await fs.writeFile(
					path.join(javaPackagePath, filename),
					await readAndroidTemplateSource(filename),
					'utf8',
				);
			}

			await fs.writeFile(
				path.join(javaPackagePath, 'ForegroundServicePackage.kt'),
				FOREGROUND_SERVICE_PACKAGE_KOTLIN,
				'utf8',
			);

			return config;
		},
	]);

const withForegroundService: ConfigPlugin = (config) => {
	config = withForegroundServiceManifest(config);
	config = withForegroundServicePackageRegistration(config);
	config = withForegroundServiceNativeFiles(config);
	return config;
};

export default withForegroundService;
