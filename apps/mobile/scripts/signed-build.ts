#!/usr/bin/env bun
/**
 * Signed Android release build — THE release path (Track B, no EAS).
 *
 * Pulls the upload keystore + passwords from env (injected by `secretspec run`),
 * drops them into android/ (keystore file, gradle.properties, release
 * signingConfig in build.gradle), runs the gradle bundle/assemble task, and
 * copies the artifact to --output (default build/fressh-android.aab — the path
 * CI and the fastlane lanes consume).
 *
 *   turbo build:android --filter @fressh/mobile        # via package.json build:android
 *   secretspec run --profile production -- bun run build:android
 *
 * @see https://docs.expo.dev/guides/local-app-production/
 *
 * Effect-ts: @effect/platform-bun runtime/services, effect/cli for arg
 * parsing, effect/process (ChildProcessSpawner) for spawning, and the
 * effect FileSystem/Path services (no node:fs / node:path). Mirrors the pattern
 * in ./screenshots.ts.
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  Stream,
  String as Str,
} from 'effect';
import { Command as CliCommand, Flag } from 'effect/cli';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

const COMMAND_NAME = 'signed-build';

class SignedBuildError extends Schema.TaggedError<
  SignedBuildError,
  { readonly brand: unique symbol }
>()('SignedBuildError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

// ---------------------------------------------------------------------------
// process helpers (effect/process)
// ---------------------------------------------------------------------------

/** Spawn a command, streaming its stdout+stderr to the terminal; fail on non-zero exit. */
const runInherit = (label: string, command: ChildProcess.Command) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      yield* Effect.log(`$ ${label}`);
      const handle = yield* spawner.spawn(command);
      yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.sync(() => process.stdout.write(chunk)),
        ),
      );
      const code = yield* handle.exitCode;
      if (code !== 0) {
        return yield* SignedBuildError.make({
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
      if (value === undefined || value === '') {
        return yield* SignedBuildError.make({
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

const main = (format: 'aab' | 'apk', output: Option.Option<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* Effect.log(`Making signed build. Format: ${format}`);

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
    yield* Effect.log(`Keystore written to ${keystorePath}`);

    // Ensure gradle.properties is configured
    // https://docs.expo.dev/guides/local-app-production/#update-gradle-variables
    const gradlePropertiesSuffix = `
        FRESSH_UPLOAD_STORE_FILE=${keystoreFileName}
        FRESSH_UPLOAD_KEY_ALIAS=${secrets.keystoreAlias}
        FRESSH_UPLOAD_STORE_PASSWORD=${secrets.keystorePassword}
        FRESSH_UPLOAD_KEY_PASSWORD=${secrets.keyPassword}
        `;
    const currentGradleProperties = yield* fs.readFileString(gradlePropsPath);
    if (
      !Str.includes(Str.trim(gradlePropertiesSuffix))(currentGradleProperties)
    ) {
      yield* fs.writeFileString(
        gradlePropsPath,
        `${currentGradleProperties}\n\n${gradlePropertiesSuffix}`,
      );
      yield* Effect.log(`Gradle properties written to ${gradlePropsPath}`);
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
    if (!Str.includes(Str.trim(releaseSigningConfig))(currentBuildGradle)) {
      // oxlint-disable-next-line effecttsgo/prefer-effect-string -- replacer callback; Str.replace only takes a string replacement
      const withReleaseSigning = currentBuildGradle.replace(
        /signingConfigs \{([\s\S]*?)\}/, // Modify existing signingConfigs without removing debug
        (match) => {
          if (Str.includes('release {')(match)) {
            return Str.replace(
              /release \{([\s\S]*?)\}/,
              releaseSigningConfig,
            )(match);
          }
          return Str.trim(match) + releaseSigningConfig;
        },
      );
      const newBuildGradle = Str.replace(
        /buildTypes \{([\s\S]*?)release \{([\s\S]*?)signingConfig signingConfigs\.debug/, // Ensure release config uses signingConfigs.release
        `buildTypes { $1release { $2signingConfig signingConfigs.release`,
      )(withReleaseSigning);
      yield* fs.writeFileString(buildGradlePath, newBuildGradle);
      yield* Effect.log(`Build gradle written to ${buildGradlePath}`);
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

    // Copy the gradle artifact to the stable path the workflows / fastlane
    // lanes consume (apps/mobile/build/fressh-android.{aab,apk}).
    const gradleArtifact =
      format === 'aab'
        ? path.join(
            androidDir,
            'app/build/outputs/bundle/release/app-release.aab',
          )
        : path.join(
            androidDir,
            'app/build/outputs/apk/release/app-release.apk',
          );
    const outputPath = path.resolve(
      mobileDir,
      Option.getOrElse(output, () => `build/fressh-android.${format}`),
    );
    yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
    yield* fs.copyFile(gradleArtifact, outputPath);
    yield* Effect.log(`Artifact: ${outputPath}`);
  });

const command = CliCommand.make(
  COMMAND_NAME,
  {
    format: Flag.Literals('format', ['aab', 'apk']).pipe(
      Flag.withAlias('f'),
      Flag.withDefault('aab' as const),
      Flag.withDescription('The format of the build to produce'),
    ),
    output: Flag.String('output').pipe(
      Flag.withAlias('o'),
      Flag.optional,
      Flag.withDescription(
        'Where to copy the built artifact (default build/fressh-android.<format>)',
      ),
    ),
  },
  ({ format, output }) => main(format, output),
);

CliCommand.run(command, { version: '0.0.1' }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- script entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
