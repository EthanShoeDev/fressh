/**
 * https://docs.expo.dev/guides/local-app-production/
 */
import * as fsp from 'fs/promises';
import * as path from 'path';
import { boolean, command, flag, oneOf, option, run } from 'cmd-ts';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { cmd } from './script-lib';

async function getSecrets(): Promise<{
	keystoreBase64: string;
	keystoreAlias: string;
	keystorePassword: string;
}> {
	const { stdout: rawBwItemString } = await cmd(
		`bw get item "fressh keystore" --raw`,
		{
			stdio: 'pipe',
		},
	);
	const bwItemSchema = z.looseObject({
		login: z.looseObject({
			username: z.string(),
			password: z.string(),
		}),
		fields: z.array(
			z.looseObject({
				name: z.string(),
				value: z.string(),
			}),
		),
	});
	const bwItem = bwItemSchema.parse(JSON.parse(rawBwItemString) as unknown, {
		reportInput: true,
	});
	const keystoreBase64 = bwItem.fields.find(
		(field) => field.name === 'keystore',
	)?.value;
	if (!keystoreBase64) throw new Error('Keystore not found');
	return {
		keystoreBase64,
		keystoreAlias: bwItem.login.username,
		keystorePassword: bwItem.login.password,
	};
}

const signedBuildCommand = command({
	name: 'signed-build',
	description: 'Build a signed release build of the app',
	args: {
		format: option({
			long: 'format',
			type: oneOf(['aab', 'apk']),
			short: 'f',
			description: 'The format of the build to build',
			defaultValue: () => 'aab',
		}),
		ghRelease: flag({
			long: 'gh-release',
			type: boolean,
			short: 'g',
			description: 'Whether to create a GitHub release (deprecated, use release-it instead)',
			defaultValue: () => false,
		}),
	},
	handler: async ({ format, ghRelease }) => {
		{
			if (ghRelease && format !== 'apk')
				throw new Error('ghRelease is only supported for apk builds');

			console.log(
				'Making signed build. Format:',
				format,
				'GH Release:',
				ghRelease,
			);
			const secrets = await getSecrets();
			await cmd(`pnpm run prebuild:clean`);

			// Ensure keystore is in the right place
			// https://docs.expo.dev/guides/local-app-production/#create-an-upload-key
			// Generated with:
			// sudo keytool -genkey -v -keystore fressh-upload-key.keystore -alias fressh-key-alias -keyalg RSA -keysize 2048 -validity 10000
			const keystorePath = `./android/app/fressh-upload-key.keystore`;
			const keystoreFileName = path.basename(keystorePath);
			// const bufferShouldEqual = await fsp.readFile(keystoreFileName, 'base64');
			// await fsp.writeFile(
			// 	'./debug.log',
			// 	JSON.stringify(
			// 		{
			// 			...secrets,
			// 			bufferShouldEqual,
			// 		},
			// 		null,
			// 		2,
			// 	),
			// );
			await fsp.writeFile(
				keystorePath,
				Buffer.from(secrets.keystoreBase64, 'base64'),
				'base64',
			);
			console.log(`Keystore written to ${keystorePath}`);

			// Ensure gradle.properties is configured
			// https://docs.expo.dev/guides/local-app-production/#update-gradle-variables
			const gradlePropertiesSuffix = `
        FRESSH_UPLOAD_STORE_FILE=${keystoreFileName}
        FRESSH_UPLOAD_KEY_ALIAS=${secrets.keystoreAlias}
        FRESSH_UPLOAD_STORE_PASSWORD=${secrets.keystorePassword}
        FRESSH_UPLOAD_KEY_PASSWORD=${secrets.keystorePassword}
        `;
			const currentGradleProperties = await fsp.readFile(
				'./android/gradle.properties',
				'utf8',
			);

			if (!currentGradleProperties.includes(gradlePropertiesSuffix.trim())) {
				await fsp.writeFile(
					'./android/gradle.properties',
					`${currentGradleProperties}\n\n${gradlePropertiesSuffix}`,
				);
				console.log(`Gradle properties written to ./android/gradle.properties`);
			}

			// Ensure there is a release signing config in android/app/build.gradle
			// https://docs.expo.dev/guides/local-app-production/#add-signing-config-to-buildgradle
			const releaseSigningConfig = `
                release {
                    if (project.hasProperty('FRESSH_UPLOAD_STORE_FILE')) {
                        storeFile file(FRESSH_UPLOAD_STORE_FILE)
                        storePassword FRESSH_UPLOAD_STORE_PASSWORD
                        keyAlias FRESSH_UPLOAD_KEY_ALIAS
                        keyPassword FRESSH_UPLOAD_KEY_PASSWORD
                    }
                }`;
			const currentBuildGradle = await fsp.readFile(
				'./android/app/build.gradle',
				'utf8',
			);
			if (!currentBuildGradle.includes(releaseSigningConfig.trim())) {
				const newBuildGradle = currentBuildGradle
					.replace(
						/signingConfigs \{([\s\S]*?)\}/, // Modify existing signingConfigs without removing debug
						(match) => {
							if (match.includes('release {')) {
								return match.replace(
									/release \{([\s\S]*?)\}/,
									releaseSigningConfig,
								);
							}
							return match.trim() + releaseSigningConfig;
						},
					)
					.replace(
						/buildTypes \{([\s\S]*?)release \{([\s\S]*?)signingConfig signingConfigs\.debug/, // Ensure release config uses signingConfigs.release
						`buildTypes { $1release { $2signingConfig signingConfigs.release`,
					);
				await fsp.writeFile('./android/app/build.gradle', newBuildGradle);
				console.log(`Build gradle written to ./android/app/build.gradle`);
			}

			const bundleCommand =
				format === 'aab' ? 'bundleRelease' : 'assembleRelease';
			await cmd(`./gradlew app:${bundleCommand}`, {
				relativeCwd: './android',
			});

			if (ghRelease)
				await cmd(
					`gh release create v${packageJson.version} ./android/app/build/outputs/apk/release/app-release.apk`,
				);
		}
	},
});

void run(signedBuildCommand, process.argv.slice(2));
