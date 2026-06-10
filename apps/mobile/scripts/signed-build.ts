#!/usr/bin/env bun
/**
 * Local signed Android release build.
 *
 * Pulls the upload keystore + passwords, drops them into android/ (keystore
 * file, gradle.properties, release signingConfig in build.gradle), then runs
 * the gradle bundle/assemble task. Optionally cuts a GitHub release with the APK.
 *
 *   bun run build:signed:aab            # signed .aab (Play upload artifact)
 *   bun run build:signed:apk            # signed .apk (sideloadable)
 *
 * @see https://docs.expo.dev/guides/local-app-production/
 *
 * Effect-ts: @effect/platform-bun runtime/services, effect/unstable/cli for arg
 * parsing, effect/unstable/process (ChildProcessSpawner) for spawning, and the
 * effect FileSystem/Path services (no node:fs / node:path). Mirrors the pattern
 * in ./screenshots.ts.
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Path, Stream } from 'effect';
import { Command as CliCommand, Flag } from 'effect/unstable/cli';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import packageJson from '../package.json' with { type: 'json' };

const COMMAND_NAME = 'signed-build';

class SignedBuildError extends Data.TaggedError('SignedBuildError')<{
	message: string;
	cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// process helpers (effect/unstable/process)
// ---------------------------------------------------------------------------

/** Spawn a command, streaming its stdout+stderr to the terminal; fail on non-zero exit. */
const runInherit = (label: string, command: ChildProcess.Command) =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			yield* Effect.sync(() => console.log(`\n$ ${label}`));
			const handle = yield* spawner.spawn(command);
			yield* handle.all.pipe(
				Stream.decodeText(),
				Stream.runForEach((chunk) =>
					Effect.sync(() => process.stdout.write(chunk)),
				),
			);
			const code = yield* handle.exitCode;
			if (code !== 0) {
				return yield* new SignedBuildError({
					message: `${label} failed (exit ${code})`,
				});
			}
		}),
	);

// ---------------------------------------------------------------------------
// secrets
// ---------------------------------------------------------------------------

/**
 * Read the upload keystore + signing passwords from the environment.
 *
 * Values are injected by `secretspec run` (keyring locally / GitHub Secrets in
 * CI) — see apps/mobile/secretspec.toml and
 * docs/projects/ci-building-and-releasing.md. This replaces the old `bw get item`
 * call: `bw` is not a secretspec provider, and `bws` (Bitwarden Secrets Manager)
 * isn't available on our self-hosted Vaultwarden.
 *
 *   secretspec run --profile production -- bun run build:signed:aab
 */
const getSecrets = Effect.gen(function* () {
	const read = (name: string) =>
		Effect.gen(function* () {
			const value = process.env[name];
			if (!value) {
				return yield* new SignedBuildError({
					message: `Missing ${name}. Run via \`secretspec run --profile production -- ...\` so signing secrets are injected (see apps/mobile/secretspec.toml).`,
				});
			}
			return value;
		});

	const keystoreBase64 = yield* read('FRESSH_ANDROID_KEYSTORE_BASE64');
	const keystoreAlias = yield* read('FRESSH_ANDROID_KEY_ALIAS');
	const keystorePassword = yield* read('FRESSH_ANDROID_KEYSTORE_PASSWORD');
	// Key password defaults to the store password (single-password keystores).
	const keyPassword =
		process.env.FRESSH_ANDROID_KEY_PASSWORD ?? keystorePassword;

	return { keystoreBase64, keystoreAlias, keystorePassword, keyPassword };
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

const main = (format: 'aab' | 'apk', ghRelease: boolean) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		if (ghRelease && format !== 'apk') {
			return yield* new SignedBuildError({
				message: '--gh-release is only supported for apk builds',
			});
		}
		console.log(
			`Making signed build. Format: ${format}, GH Release: ${ghRelease}`,
		);

		const scriptDir = import.meta.dirname; // apps/mobile/scripts
		const mobileDir = path.resolve(scriptDir, '..');
		const androidDir = path.join(mobileDir, 'android');
		const keystorePath = path.join(
			androidDir,
			'app',
			'fressh-upload-key.keystore',
		);
		const keystoreFileName = path.basename(keystorePath);
		const gradlePropsPath = path.join(androidDir, 'gradle.properties');
		const buildGradlePath = path.join(androidDir, 'app', 'build.gradle');

		const secrets = yield* getSecrets;

		yield* runInherit(
			'bun run prebuild:clean',
			ChildProcess.make('bun', ['run', 'prebuild:clean'], {
				cwd: mobileDir,
				extendEnv: true,
			}),
		);

		// Ensure keystore is in the right place
		// https://docs.expo.dev/guides/local-app-production/#create-an-upload-key
		// Generated with:
		// keytool -genkey -v -keystore fressh-upload-key.keystore -alias fressh-key-alias -keyalg RSA -keysize 2048 -validity 10000
		yield* fs.writeFile(
			keystorePath,
			Buffer.from(secrets.keystoreBase64, 'base64'),
		);
		console.log(`Keystore written to ${keystorePath}`);

		// Ensure gradle.properties is configured
		// https://docs.expo.dev/guides/local-app-production/#update-gradle-variables
		const gradlePropertiesSuffix = `
        FRESSH_UPLOAD_STORE_FILE=${keystoreFileName}
        FRESSH_UPLOAD_KEY_ALIAS=${secrets.keystoreAlias}
        FRESSH_UPLOAD_STORE_PASSWORD=${secrets.keystorePassword}
        FRESSH_UPLOAD_KEY_PASSWORD=${secrets.keyPassword}
        `;
		const currentGradleProperties = yield* fs.readFileString(gradlePropsPath);
		if (!currentGradleProperties.includes(gradlePropertiesSuffix.trim())) {
			yield* fs.writeFileString(
				gradlePropsPath,
				`${currentGradleProperties}\n\n${gradlePropertiesSuffix}`,
			);
			console.log(`Gradle properties written to ${gradlePropsPath}`);
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
		const currentBuildGradle = yield* fs.readFileString(buildGradlePath);
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
			yield* fs.writeFileString(buildGradlePath, newBuildGradle);
			console.log(`Build gradle written to ${buildGradlePath}`);
		}

		const bundleCommand =
			format === 'aab' ? 'bundleRelease' : 'assembleRelease';
		yield* runInherit(
			`./gradlew app:${bundleCommand}`,
			ChildProcess.make('./gradlew', [`app:${bundleCommand}`], {
				cwd: androidDir,
				extendEnv: true,
			}),
		);

		if (ghRelease) {
			const apkPath = path.join(
				androidDir,
				'app',
				'build',
				'outputs',
				'apk',
				'release',
				'app-release.apk',
			);
			yield* runInherit(
				`gh release create v${packageJson.version}`,
				ChildProcess.make('gh', [
					'release',
					'create',
					`v${packageJson.version}`,
					apkPath,
				]),
			);
		}
	});

const command = CliCommand.make(
	COMMAND_NAME,
	{
		format: Flag.choice('format', ['aab', 'apk']).pipe(
			Flag.withAlias('f'),
			Flag.withDefault('aab' as const),
			Flag.withDescription('The format of the build to produce'),
		),
		ghRelease: Flag.boolean('gh-release').pipe(
			Flag.withAlias('g'),
			Flag.withDefault(false),
			Flag.withDescription(
				'Create a GitHub release with the APK (deprecated — release flow is moving to changesets + `gh release upload` in CI; see docs/projects/ci-building-and-releasing.md)',
			),
		),
	},
	({ format, ghRelease }) => main(format, ghRelease),
);

CliCommand.run(command, { version: '0.0.1' }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
