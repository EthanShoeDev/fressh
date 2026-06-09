#!/usr/bin/env bun
/**
 * One-command marketing-screenshot pipeline.
 *
 * For each target platform it: builds a Release variant of the app with
 * EXPO_PUBLIC_SCREENSHOT_SEED=1 (so the Servers/Commands tabs are pre-populated
 * with demo data and the standalone build needs no Metro), resets the iOS
 * simulator keychain (so only the demo servers show — not your real hosts), and
 * runs the Maestro flow (test/e2e/screenshots.yml) which writes one PNG per
 * screen into packages/assets/mobile-screenshots/.
 *
 *   bun run screenshots                 # both platforms, full build
 *   bun run screenshots -p ios          # one platform
 *   bun run screenshots --skip-build    # reuse the installed seed build (faster)
 *
 * Effect-ts: @effect/platform-bun runtime/services, effect/unstable/cli for arg
 * parsing, effect/unstable/process (CommandExecutor) for spawning, and the
 * effect Path service (no node:path).
 *
 * @see docs/cloned-repos-as-docs/effect-smol/packages/effect/src/unstable/process/ChildProcess.ts
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Data, Effect, Option, Path, Stream } from 'effect';
import { Command as CliCommand, Flag } from 'effect/unstable/cli';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

const COMMAND_NAME = 'screenshots';

type Platform = 'ios' | 'android';

/** Tagged failure for the screenshot pipeline (effect prefers tagged errors in
 *  the failure channel over a bare `Error`). */
class ScreenshotError extends Data.TaggedError('ScreenshotError')<{
	readonly message: string;
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
				return yield* new ScreenshotError({
					message: `${label} failed (exit ${code})`,
				});
			}
		}),
	);

/** Spawn a command and return its buffered stdout. */
const runString = (command: ChildProcess.Command) =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			return yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
		}),
	);

// ---------------------------------------------------------------------------
// device discovery
// ---------------------------------------------------------------------------

const resolveDevice = (platform: Platform, override: Option.Option<string>) =>
	Effect.gen(function* () {
		if (Option.isSome(override)) return override.value;

		if (platform === 'ios') {
			const out = yield* runString(
				ChildProcess.make('xcrun', ['simctl', 'list', 'devices', 'booted']),
			);
			const udid = /\(([0-9A-F]{8}-[0-9A-F-]{27})\)/.exec(out)?.[1];
			if (!udid) {
				return yield* new ScreenshotError({
					message:
						'No booted iOS simulator found. Boot one (Simulator.app) and retry.',
				});
			}
			return udid;
		}

		const out = yield* runString(ChildProcess.make('adb', ['devices']));
		const serial = out
			.split('\n')
			.slice(1)
			.map((l) => l.trim())
			.find((l) => l.endsWith('\tdevice'))
			?.split('\t')[0];
		if (!serial) {
			return yield* new ScreenshotError({
				message: 'No booted Android device/emulator found (`adb devices`).',
			});
		}
		return serial;
	});

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

const capturePlatform = (
	platform: Platform,
	opts: {
		mobileDir: string;
		repoRoot: string;
		screenshotsDir: string;
		maestroBin: string;
		expoBin: string;
		build: boolean;
		keychainReset: boolean;
		device: Option.Option<string>;
	},
) =>
	Effect.gen(function* () {
		console.log(`\n=== ${platform} ===`);
		const device = yield* resolveDevice(platform, opts.device);
		console.log(`device: ${device}`);

		// 1. Build + install the seed Release variant (standalone bundle, no Metro).
		if (opts.build) {
			const args =
				platform === 'ios'
					? ['run:ios', '--configuration', 'Release', '--no-bundler']
					: ['run:android', '--variant', 'release'];
			yield* runInherit(
				`expo ${args.join(' ')} (EXPO_PUBLIC_SCREENSHOT_SEED=1)`,
				ChildProcess.make(opts.expoBin, args, {
					cwd: opts.mobileDir,
					env: { EXPO_PUBLIC_SCREENSHOT_SEED: '1' },
					extendEnv: true,
				}),
			);
		} else {
			console.log('skip-build: reusing the installed seed build');
		}

		// 2. (iOS) Reset the simulator keychain so only the demo servers show.
		if (platform === 'ios' && opts.keychainReset) {
			yield* runInherit(
				`xcrun simctl keychain ${device} reset`,
				ChildProcess.make('xcrun', ['simctl', 'keychain', device, 'reset']),
			);
		}

		// 3. Pre-flight: Maestro's iOS driver uses port 5600; warn if it's taken
		//    (e.g. ActivityWatch) — that collision makes the driver hang silently.
		if (platform === 'ios') {
			const lsof = yield* runString(
				ChildProcess.make('lsof', ['-nP', '-iTCP:5600', '-sTCP:LISTEN']),
			).pipe(Effect.orElseSucceed(() => ''));
			if (lsof.trim().length > 0) {
				console.warn(
					"⚠️  Port 5600 is in use — Maestro's iOS driver may hang. Free it (e.g. quit ActivityWatch) if the run stalls at startup.",
				);
			}
		}

		// 4. Drive the app and capture. Maestro interpolates ${OUTPUT}/${PLATFORM}
		//    into the takeScreenshot paths and appends `.png`.
		yield* runInherit(
			`maestro test screenshots.yml (${platform})`,
			ChildProcess.make(
				opts.maestroBin,
				[
					'--device',
					device,
					'test',
					'test/e2e/screenshots.yml',
					'--env',
					`OUTPUT=${opts.screenshotsDir}`,
					'--env',
					`PLATFORM=${platform}`,
				],
				{ cwd: opts.mobileDir, extendEnv: true },
			),
		);

		console.log(`✅ ${platform} screenshots written to ${opts.screenshotsDir}`);
	});

const main = (
	platform: 'ios' | 'android' | 'both',
	skipBuild: boolean,
	skipKeychainReset: boolean,
	device: Option.Option<string>,
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;

		const scriptDir = import.meta.dirname; // apps/mobile/scripts
		const mobileDir = path.resolve(scriptDir, '..');
		const repoRoot = path.resolve(scriptDir, '..', '..', '..');
		const screenshotsDir = path.resolve(
			repoRoot,
			'packages',
			'assets',
			'mobile-screenshots',
		);
		const expoBin = path.resolve(repoRoot, 'node_modules', '.bin', 'expo');
		const home = process.env.HOME ?? '';
		const maestroBin = path.join(home, '.maestro', 'bin', 'maestro');

		const targets: Platform[] =
			platform === 'both' ? ['ios', 'android'] : [platform];

		if (Option.isSome(device) && targets.length > 1) {
			return yield* new ScreenshotError({
				message: '--device requires a single --platform.',
			});
		}

		for (const target of targets) {
			yield* capturePlatform(target, {
				mobileDir,
				repoRoot,
				screenshotsDir,
				maestroBin,
				expoBin,
				build: !skipBuild,
				keychainReset: !skipKeychainReset,
				device,
			});
		}
	});

const command = CliCommand.make(
	COMMAND_NAME,
	{
		platform: Flag.choice('platform', ['ios', 'android', 'both']).pipe(
			Flag.withAlias('p'),
			Flag.withDefault('both' as const),
			Flag.withDescription('Platform(s) to capture'),
		),
		skipBuild: Flag.boolean('skip-build').pipe(
			Flag.withDefault(false),
			Flag.withDescription(
				'Skip the Release build and reuse the installed seed build',
			),
		),
		skipKeychainReset: Flag.boolean('skip-keychain-reset').pipe(
			Flag.withDefault(false),
			Flag.withDescription(
				'iOS: do not reset the simulator keychain before capturing',
			),
		),
		device: Flag.string('device').pipe(
			Flag.withAlias('d'),
			Flag.optional,
			Flag.withDescription('Explicit device id/UDID (single --platform only)'),
		),
	},
	({ platform, skipBuild, skipKeychainReset, device }) =>
		main(platform, skipBuild, skipKeychainReset, device),
);

CliCommand.run(command, { version: '0.0.1' }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
