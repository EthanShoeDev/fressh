#!/usr/bin/env bun
/**
 * Store submission via `eas submit` (a free EAS service — see
 * docs/projects/ci-building-and-releasing.md, "The 'drop EAS' spectrum").
 *
 * Takes the artifact produced by `turbo build:android` / `build:ios`
 * (apps/mobile/build/fressh-*.{aab,ipa}) and uploads it to the store test
 * channel configured in eas.json's submit.production profile:
 *   - Android -> Google Play "internal testing" track
 *   - iOS     -> App Store Connect / TestFlight (all EAS iOS submits land there)
 *
 *   secretspec run --profile production -- bun run submit:android
 *   secretspec run --profile production -- bun run submit:ios
 *
 * eas.json references store credentials as FILE PATHS (serviceAccountKeyPath /
 * ascApiKeyPath — env vars are not supported), so this script materializes the
 * key files from secretspec-injected env vars next to eas.json, runs the
 * submit, and deletes them again. Both paths are gitignored + .easignored.
 *
 * Effect-ts: same pattern as ./signed-build.ts.
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Option, Path, Stream } from 'effect';
import { Command as CliCommand, Flag } from 'effect/unstable/cli';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

const COMMAND_NAME = 'submit';
const EAS_CLI = 'eas-cli@20.1.0'; // keep in sync with build:android/build:ios

class SubmitError extends Data.TaggedError('SubmitError')<{
	message: string;
	cause?: unknown;
}> {}

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
				return yield* new SubmitError({
					message: `${label} failed (exit ${code})`,
				});
			}
		}),
	);

const readEnv = (name: string, hint: string) =>
	Effect.gen(function* () {
		const value = process.env[name];
		if (!value) {
			return yield* new SubmitError({
				message: `Missing ${name} (${hint}). Run via \`secretspec run --profile production -- ...\` so it is injected (see apps/mobile/secretspec.toml).`,
			});
		}
		return value;
	});

const platformConfig = {
	android: {
		artifact: 'build/fressh-android.aab',
		// Referenced by eas.json submit.production.android.serviceAccountKeyPath.
		keyFile: 'google-service-account.json',
		keyEnv: 'GOOGLE_SERVICE_ACCOUNT_KEY_JSON',
		keyHint: 'Google Play service-account JSON, verbatim',
		decode: (value: string) => Buffer.from(value, 'utf8'),
	},
	ios: {
		artifact: 'build/fressh-ios.ipa',
		// Referenced by eas.json submit.production.ios.ascApiKeyPath.
		keyFile: 'asc-api-key.p8',
		keyEnv: 'ASC_API_KEY_P8',
		keyHint: 'App Store Connect API .p8 key, verbatim',
		decode: (value: string) => Buffer.from(value, 'utf8'),
	},
} as const;

const main = (
	platform: 'android' | 'ios',
	artifactPath: Option.Option<string>,
	whatToTest: Option.Option<string>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const config = platformConfig[platform];
		const mobileDir = path.resolve(import.meta.dirname, '..');
		const artifact = path.resolve(
			mobileDir,
			Option.getOrElse(artifactPath, () => config.artifact),
		);
		const keyPath = path.join(mobileDir, config.keyFile);

		if (!(yield* fs.exists(artifact))) {
			return yield* new SubmitError({
				message: `Artifact not found: ${artifact}. Build it first (turbo build:${platform} --filter @fressh/mobile).`,
			});
		}

		const key = yield* readEnv(config.keyEnv, config.keyHint);

		// Materialize the store credential file for eas.json, submit, then remove
		// it even on failure (acquireRelease).
		yield* Effect.scoped(
			Effect.gen(function* () {
				yield* Effect.acquireRelease(
					fs
						.writeFile(keyPath, config.decode(key))
						.pipe(
							Effect.tap(() =>
								Effect.sync(() => console.log(`Wrote ${keyPath}`)),
							),
						),
					() => fs.remove(keyPath).pipe(Effect.ignore),
				);

				const args = [
					EAS_CLI,
					'submit',
					'--platform',
					platform,
					'--path',
					artifact,
					'--profile',
					'production',
					'--non-interactive',
					'--wait',
					...(platform === 'ios' && Option.isSome(whatToTest)
						? ['--what-to-test', whatToTest.value]
						: []),
				];
				yield* runInherit(
					`bunx eas submit -p ${platform}`,
					ChildProcess.make('bunx', args, {
						cwd: mobileDir,
						extendEnv: true,
					}),
				);
			}),
		);
	});

const command = CliCommand.make(
	COMMAND_NAME,
	{
		platform: Flag.choice('platform', ['android', 'ios']).pipe(
			Flag.withAlias('p'),
			Flag.withDescription('Which store to submit to'),
		),
		path: Flag.string('path').pipe(
			Flag.optional,
			Flag.withDescription(
				'Artifact to submit (defaults to the turbo build:android/ios output)',
			),
		),
		whatToTest: Flag.string('what-to-test').pipe(
			Flag.optional,
			Flag.withDescription('TestFlight "What to Test" note (iOS only)'),
		),
	},
	({ platform, path, whatToTest }) => main(platform, path, whatToTest),
);

CliCommand.run(command, { version: '0.0.1' }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
