#!/usr/bin/env bun
/**
 * One-command marketing-screenshot pipeline.
 *
 * For each target platform it:
 *   1. builds a Release variant with EXPO_PUBLIC_SCREENSHOT_SEED=1 (Servers/Commands
 *      tabs pre-populated; standalone bundle, no Metro — a dev-client `clearState`
 *      drops to the Expo launcher, which an automated flow can't get past),
 *   2. (iOS) resets the simulator keychain so only the demo servers show,
 *   3. spins up a throwaway docker sshd (real bash shell, git installed) so the
 *      terminal + smart-terminal (OSC 633) screens are representative — the public
 *      rebex demo's shell closes immediately and exposes no interactive shell,
 *   4. runs the Maestro flow (test/e2e/screenshots.yml) ONCE PER THEME, writing
 *      `<screen>-<theme>-<platform>.png` into packages/assets/mobile-screenshots/,
 *   5. tears the container down, and finally
 *   6. emits resized README/website derivatives + copies a store subset into
 *      fastlane (scripts/screenshot-derive.ts).
 *
 *   bun run screenshots                      # both platforms, every theme, full build
 *   bun run screenshots -p android           # one platform
 *   bun run screenshots --skip-build         # reuse the installed seed build (faster)
 *   bun run screenshots --themes graphite    # a subset of themes
 *   bun run screenshots --no-docker          # skip the temp sshd (rebex fallback)
 *   bun run screenshots --no-derive          # skip the resize/fan-out step
 *
 * Credentials: the temp sshd's throwaway password is generated per run and forwarded
 * to Maestro via --env (never in git, never in the app bundle). To point the flow at
 * an EXTERNAL host instead, set SCREENSHOT_SSH_HOST/USER/PASSWORD (e.g. via secretspec
 * `secretspec run --profile screenshots -- bun run screenshots`).
 *
 * Effect-ts: @effect/platform-bun runtime/services, effect/cli for arg
 * parsing, effect/process (CommandExecutor) for spawning, and the effect
 * Path service (no node:path).
 *
 * @see docs/projects/automated-screenshots-improvements.md
 * @see docs/cloned-repos-as-docs/effect-smol/packages/effect/src/unstable/process/ChildProcess.ts
 */
import { tmpdir } from 'node:os';

import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Config,
  Effect,
  Option,
  Path,
  pipe,
  Schema,
  Stream,
  String as Str,
} from 'effect';
import { Command as CliCommand, Flag } from 'effect/cli';
import { SecureRandom } from 'effect/crypto';
import { Hex } from 'effect/encoding';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import {
  APP_THEME_IDS,
  APP_THEMES,
  type AppThemeName,
} from '../src/lib/app-themes';
import { deriveScreenshots } from './screenshot-derive';

const COMMAND_NAME = 'screenshots';

type Platform = 'ios' | 'android';

/**
 * Pinned host port for Maestro's iOS XCUITest driver, passed via the global
 * `--driver-host-port` flag so the port is deterministic (and the pre-flight check
 * below is meaningful). Maestro 2.6.0 already defaults this to 22087 — NOT the 5600
 * that older Maestro used and that ActivityWatch's `aw-server` listens on — so pinning
 * it here keeps the run clear of that historical collision without anyone needing to
 * quit ActivityWatch. Change this if 22087 is ever taken on a given machine.
 */
const IOS_DRIVER_HOST_PORT = '22087';

/**
 * The app's selectable themes come from the dependency-free `app-themes` module —
 * the single source of truth shared with the RN app (importing theme.tsx here would
 * drag in react-native/uniwind, which won't run under bun). Capture order follows
 * the array; filenames key off the id, and `themeLabel` is what the flow taps on
 * the native Appearance screen.
 */
const ALL_THEMES = APP_THEME_IDS;
type ThemeId = AppThemeName;

const themeLabel = (id: ThemeId) =>
  pipe(
    Arr.findFirst(APP_THEMES, (t) => t.id === id),
    Option.map((t) => t.label),
    Option.getOrElse(() => id),
  );

/** Resolved SSH connection the flow types into the connect form. */
type Connection = {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly pass: string;
  readonly kind: 'docker' | 'override' | 'rebex';
};

/** Tagged failure for the screenshot pipeline (effect prefers tagged errors in
 *  the failure channel over a bare `Error`). */
class ScreenshotError extends Schema.TaggedError<
  ScreenshotError,
  { readonly brand: unique symbol }
>()('ScreenshotError', { message: Schema.String }) {}

// ---------------------------------------------------------------------------
// process helpers (effect/process)
// ---------------------------------------------------------------------------

/** Spawn a command, streaming its stdout+stderr to the terminal; fail on non-zero exit. */
const runInherit = (label: string, command: ChildProcess.Command) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      yield* Effect.log(`\n$ ${label}`);
      const handle = yield* spawner.spawn(command);
      yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.sync(() => process.stdout.write(chunk)),
        ),
      );
      const code = yield* handle.exitCode;
      if (code !== 0) {
        return yield* ScreenshotError.make({
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

/** Spawn a command, ignoring output and exit code (best-effort cleanup). */
const runQuiet = (command: ChildProcess.Command) =>
  runString(command).pipe(
    Effect.orElseSucceed(() => ''),
    Effect.asVoid,
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
      const udidRe = /\(([0-9A-F]{8}-[0-9A-F-]{27})\)/;
      const line = Option.getOrUndefined(
        Arr.findFirst(Str.split(out, '\n'), (l) => udidRe.test(l)),
      );
      const udid = line === undefined ? undefined : udidRe.exec(line)?.[1];
      if (line === undefined || udid === undefined || udid === '') {
        return yield* ScreenshotError.make({
          message:
            'No booted iOS simulator found. Boot one (Simulator.app) and retry.',
        });
      }
      // App Store Connect requires a 6.9"/6.5" iPhone screenshot set (e.g.
      // 1320×2868). A 6.3"/6.1" sim like the plain "iPhone 16 Pro" yields
      // 1206×2622, which deliver files under the OPTIONAL 6.1" slot and leaves
      // the required larger slot empty → submission is blocked. Only "Pro Max"
      // (6.9") and "Plus" (6.7") sims produce a store-accepted size.
      const name = Str.split(Str.trim(line), /\s+\(/)[0];
      if (!/Pro Max|Plus/.test(name)) {
        yield* Effect.logWarning(
          `⚠️  booted iOS sim is "${name}" — App Store screenshots need a 6.9" device; ` +
            'boot an "iPhone 16 Pro Max" (1320×2868) before capturing store shots.',
        );
      }
      return udid;
    }

    const out = yield* runString(ChildProcess.make('adb', ['devices']));
    const serial = pipe(
      Str.split(out, '\n').slice(1),
      Arr.map(Str.trim),
      Arr.findFirst(Str.endsWith('\tdevice')),
      Option.map((l) => Str.split(l, '\t')[0]),
      Option.getOrUndefined,
    );
    if (serial === undefined || serial === '') {
      return yield* ScreenshotError.make({
        message: 'No booted Android device/emulator found (`adb devices`).',
      });
    }
    return serial;
  });

/** Resolve the maestro binary: PATH first (nix/brew), then the official installer
 *  location (~/.maestro/bin). The old hard-coded path broke nix-installed maestro. */
const resolveMaestroBin = (path: Path.Path) =>
  Effect.gen(function* () {
    const onPath = Bun.which('maestro');
    if (onPath !== null && onPath !== '') return onPath;
    const home = yield* Config.String('HOME').pipe(Config.withDefault(''));
    return path.join(home, '.maestro', 'bin', 'maestro');
  });

// ---------------------------------------------------------------------------
// temp docker sshd
//
// A throwaway, real bash shell so the terminal / smart-terminal (OSC 633) shots are
// representative. The app injects VS Code's shell-integration scripts client-side, so
// the host needs nothing but bash + sshd (git makes the "git status" preset shine).
// Image is built once (cached); the password is per-run (entrypoint chpasswd), so the
// default path needs no secrets at all. iOS sim reaches the host at 127.0.0.1; the
// Android emulator reaches it at 10.0.2.2.
// ---------------------------------------------------------------------------

const SSHD_IMAGE = 'fressh-screenshots-sshd:latest';
const SSHD_CONTAINER = 'fressh-screenshots-sshd';
// Host port for the sshd. NOT 2222: on Windows/WSL2 dev boxes the Android emulator's
// 10.0.2.2 routes to the Windows host, where OpenSSH-for-Windows commonly listens on
// 2222 — the app would then connect to *that* sshd (wrong host key, auth fails) instead
// of this container. 2223 avoids that collision and is reachable from both the iOS sim
// (127.0.0.1) and the Android emulator (10.0.2.2).
const SSHD_HOST_PORT = '2223';
const SSHD_USER = 'demo';

/** $HOME *is* a tidy git repo so the smart-terminal cwd shows `~` with a git badge and a
 *  realistic dirty tree: after the initial commit we stage one file (CHANGELOG.md), leave
 *  two modified (src/index.ts, README.md), and one untracked (src/health.ts) — so the
 *  smart-terminal details sheet's git section reads `1 staged · 2 unstaged · 1 untracked`
 *  with a 4-file list (badge ●4), not an empty/clean tree. Dotfiles are git-ignored so
 *  they stay out of the status — including `.bash_history`/`.lesshst`, which a shell
 *  session writes into $HOME: one container is reused across every theme in a run, so
 *  without ignoring them a later theme would see the earlier session's history as an
 *  untracked file and report ●5, making the dirty count inconsistent between themes. No
 *  COPY, so `docker build <dir>` needs only this file. */
const SSHD_DOCKERFILE = `# Throwaway demo sshd for marketing screenshots — never shipped.
FROM ubuntu:24.04
RUN apt-get update \\
 && apt-get install -y --no-install-recommends openssh-server bash git ca-certificates \\
 && rm -rf /var/lib/apt/lists/* \\
 && mkdir -p /var/run/sshd /run/sshd \\
 && useradd -m -s /bin/bash ${SSHD_USER} \\
 && sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \\
 && sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config \\
 && sed -i 's/^#\\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication yes/' /etc/ssh/sshd_config
USER ${SSHD_USER}
WORKDIR /home/${SSHD_USER}
RUN git config --global user.email demo@fressh.dev \\
 && git config --global user.name "Fressh Demo" \\
 && git config --global init.defaultBranch main \\
 && printf '.bashrc\\n.bash_logout\\n.profile\\n.gitconfig\\n.ssh/\\n.cache/\\n.bash_history\\n.lesshst\\n' > .gitignore \\
 && mkdir -p src \\
 && printf '# acme-api\\n\\nDemo service for fressh screenshots.\\n' > README.md \\
 && printf '{\\n  "name": "acme-api",\\n  "version": "1.4.2"\\n}\\n' > package.json \\
 && printf 'export const version = "1.4.2";\\n' > src/index.ts \\
 && git init -q && git add -A && git commit -q -m "initial commit" \\
 && printf 'export const version = "1.5.0";\\n' > src/index.ts \\
 && printf '# acme-api\\n\\nDemo service for fressh screenshots.\\n\\n## Status\\n\\nShipping soon.\\n' > README.md \\
 && printf '# Changelog\\n\\n## Unreleased\\n- Add health endpoint\\n' > CHANGELOG.md \\
 && git add CHANGELOG.md \\
 && printf 'export function health() {\\n  return "ok";\\n}\\n' > src/health.ts
USER root
EXPOSE 22
# Per-run password from $SSH_PASSWORD, then run sshd in the foreground.
ENTRYPOINT ["/bin/bash", "-c", "echo \\"${SSHD_USER}:\${SSH_PASSWORD:-password}\\" | chpasswd && exec /usr/sbin/sshd -D -e"]
`;

/** True if a usable docker CLI + daemon is reachable. */
const dockerAvailable = runString(
  ChildProcess.make('docker', ['version', '--format', '{{.Server.Version}}']),
).pipe(
  Effect.map((out) => Str.trim(out).length > 0),
  Effect.orElseSucceed(() => false),
);

/**
 * Acquire a running sshd container (scoped: torn down when the scope closes). Builds
 * the image (cached), generates a per-run password, and runs it on host port 2222.
 */
const acquireSshd = (platform: Platform) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const buildDir = path.join(tmpdir(), 'fressh-screenshots-sshd');
    // Hex (lowercase a-f0-9 only): no base64url `-`/`_`/uppercase that a secure
    // TextInput's auto-capitalize or Maestro's inputText could mistype, which
    // would break password auth even though the container is fine.
    const password = Hex.encode(SecureRandom.randomBytesUnsafe(12));

    yield* Effect.tryPromise({
      try: () => Bun.write(path.join(buildDir, 'Dockerfile'), SSHD_DOCKERFILE),
      catch: (e) =>
        ScreenshotError.make({
          message: `write Dockerfile failed: ${String(e)}`,
        }),
    });

    // Remove any leftover container from a previous interrupted run.
    yield* runQuiet(ChildProcess.make('docker', ['rm', '-f', SSHD_CONTAINER]));

    yield* runInherit(
      `docker build ${SSHD_IMAGE}`,
      ChildProcess.make('docker', ['build', '-t', SSHD_IMAGE, buildDir]),
    );
    yield* runInherit(
      `docker run ${SSHD_CONTAINER} (host :${SSHD_HOST_PORT})`,
      ChildProcess.make('docker', [
        'run',
        '-d',
        '--rm',
        '--name',
        SSHD_CONTAINER,
        // A friendly hostname so the shell prompt reads `demo@acme-api:~$` in the
        // terminal shots instead of the random 12-hex container id (the default
        // hostname). Cosmetic — the terminal body is a native GL surface, so this
        // only matters for how the captured pixels read.
        '--hostname',
        'acme-api',
        '-p',
        `${SSHD_HOST_PORT}:22`,
        '-e',
        `SSH_PASSWORD=${password}`,
        SSHD_IMAGE,
      ]),
    );

    // The Android emulator reaches the host via 10.0.2.2; the iOS sim via loopback.
    const host = platform === 'android' ? '10.0.2.2' : '127.0.0.1';
    const conn: Connection = {
      host,
      port: SSHD_HOST_PORT,
      user: SSHD_USER,
      pass: password,
      kind: 'docker',
    };
    yield* Effect.log(`sshd ready → ${conn.user}@${host}:${conn.port}`);
    return conn;
  });

const releaseSshd = runQuiet(
  ChildProcess.make('docker', ['rm', '-f', SSHD_CONTAINER]),
).pipe(Effect.tap(() => Effect.log('sshd torn down')));

/**
 * Resolve the connection params for this platform, acquiring the temp sshd as a scoped
 * resource when appropriate. Precedence: SCREENSHOT_SSH_HOST override → docker sshd →
 * rebex fallback (flow still runs, but the terminal shots are poor).
 */
const resolveConnection = (platform: Platform, opts: { docker: boolean }) =>
  Effect.gen(function* () {
    // SCREENSHOT_SSH_* are read through effect Config (default `fromEnv`
    // ConfigProvider → process.env); each has a default so absence never errors.
    const overrideHost = Str.trim(
      yield* Config.String('SCREENSHOT_SSH_HOST').pipe(Config.withDefault('')),
    );
    if (overrideHost) {
      yield* Effect.log(`connection: external override (${overrideHost})`);
      const port = Str.trim(
        yield* Config.String('SCREENSHOT_SSH_PORT').pipe(
          Config.withDefault('22'),
        ),
      );
      const user = Str.trim(
        yield* Config.String('SCREENSHOT_SSH_USER').pipe(
          Config.withDefault('demo'),
        ),
      );
      const pass = yield* Config.String('SCREENSHOT_SSH_PASSWORD').pipe(
        Config.withDefault(''),
      );
      return {
        host: overrideHost,
        port,
        user,
        pass,
        kind: 'override',
      } satisfies Connection;
    }

    if (opts.docker && (yield* dockerAvailable)) {
      return yield* Effect.acquireRelease(
        acquireSshd(platform),
        () => releaseSshd,
      );
    }

    yield* Effect.logWarning(
      '⚠️  No temp sshd (docker unavailable or --no-docker) — falling back to the\n' +
        '   rebex demo. Its shell closes immediately, so the terminal/smart-terminal\n' +
        '   shots will be poor. Install docker for representative terminal screens.',
    );
    return {
      host: 'test.rebex.net',
      port: '22',
      user: 'demo',
      pass: 'password',
      kind: 'rebex',
    } satisfies Connection;
  });

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

const runFlow = (
  platform: Platform,
  theme: ThemeId,
  device: string,
  conn: Connection,
  opts: { mobileDir: string; screenshotsDir: string; maestroBin: string },
) =>
  runInherit(
    `maestro test screenshots.yml (${platform}, ${theme})`,
    ChildProcess.make(
      opts.maestroBin,
      [
        '--device',
        device,
        // Pin the iOS driver's host port (global flag, must precede `test`) so it's
        // deterministic and matches the pre-flight check. Harmless on Android (that
        // driver uses adb-forwarded instrumentation), so only set it for iOS.
        ...(platform === 'ios'
          ? ['--driver-host-port', IOS_DRIVER_HOST_PORT]
          : []),
        'test',
        'test/e2e/screenshots.yml',
        '--env',
        `OUTPUT=${opts.screenshotsDir}`,
        '--env',
        `PLATFORM=${platform}`,
        '--env',
        `THEME=${theme}`,
        '--env',
        // The label the flow taps on the native Appearance screen (Graphite,
        // Native…) — taken from the shared theme list, not re-derived here.
        `THEME_LABEL=${themeLabel(theme)}`,
        '--env',
        `SSH_HOST=${conn.host}`,
        '--env',
        `SSH_PORT=${conn.port}`,
        '--env',
        `SSH_USER=${conn.user}`,
        '--env',
        `SSH_PASS=${conn.pass}`,
      ],
      { cwd: opts.mobileDir, extendEnv: true },
    ),
  );

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
    docker: boolean;
    themes: readonly ThemeId[];
    device: Option.Option<string>;
  },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.log(`\n=== ${platform} ===`);
      const device = yield* resolveDevice(platform, opts.device);
      yield* Effect.log(`device: ${device}`);

      // 1. Build + install the seed Release variant (standalone bundle, no Metro).
      if (opts.build) {
        const args =
          platform === 'ios'
            ? ['run:ios', '--configuration', 'Release', '--no-bundler']
            : ['run:android', '--variant', 'release', '--no-bundler'];
        yield* runInherit(
          `expo ${Arr.join(args, ' ')} (EXPO_PUBLIC_SCREENSHOT_SEED=1)`,
          ChildProcess.make(opts.expoBin, args, {
            cwd: opts.mobileDir,
            env: { EXPO_PUBLIC_SCREENSHOT_SEED: '1' },
            extendEnv: true,
          }),
        );
      } else {
        yield* Effect.log('skip-build: reusing the installed seed build');
      }

      // 2. (iOS) Reset the simulator keychain so only the demo servers show.
      if (platform === 'ios' && opts.keychainReset) {
        yield* runInherit(
          `xcrun simctl keychain ${device} reset`,
          ChildProcess.make('xcrun', ['simctl', 'keychain', device, 'reset']),
        );
      }

      // 3. Pre-flight: Maestro's iOS driver binds IOS_DRIVER_HOST_PORT; warn if it's taken
      //    (e.g. ActivityWatch) — that collision makes the driver hang silently.
      if (platform === 'ios') {
        const lsof = yield* runString(
          ChildProcess.make('lsof', [
            '-nP',
            `-iTCP:${IOS_DRIVER_HOST_PORT}`,
            '-sTCP:LISTEN',
          ]),
        ).pipe(Effect.orElseSucceed(() => ''));
        if (Str.trim(lsof).length > 0) {
          yield* Effect.logWarning(
            `⚠️  Port ${IOS_DRIVER_HOST_PORT} is in use — Maestro's iOS driver may hang. Free it (or change IOS_DRIVER_HOST_PORT) if the run stalls at startup.`,
          );
        }
      }

      // 3b. (Android) Disable the system autofill service so Google Password
      //     Manager's "Save password?" dialog can't pop over the connect form /
      //     tab bar mid-flow (it blocked the next launch's first tab tap).
      if (platform === 'android') {
        yield* runQuiet(
          ChildProcess.make('adb', [
            '-s',
            device,
            'shell',
            'settings',
            'put',
            'secure',
            'autofill_service',
            'null',
          ]),
        );
      }

      // 4. Resolve the connection (scoped temp sshd) and capture every theme.
      //    A single theme's flaky run (e.g. a missed first tap on a slow cold
      //    start) is logged and skipped rather than aborting the whole pass — the
      //    remaining themes + the derivative step still run.
      const conn = yield* resolveConnection(platform, { docker: opts.docker });
      for (const theme of opts.themes) {
        yield* Effect.log(`\n--- theme: ${theme} ---`);
        yield* runFlow(platform, theme, device, conn, opts).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `⚠️  ${platform}/${theme} capture failed (continuing): ${error.message}`,
            ),
          ),
        );
      }

      yield* Effect.log(
        `✅ ${platform} screenshots written to ${opts.screenshotsDir}`,
      );
    }),
  );

const main = (
  platform: 'ios' | 'android' | 'both',
  skipBuild: boolean,
  skipKeychainReset: boolean,
  noDocker: boolean,
  noDerive: boolean,
  themes: readonly ThemeId[],
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
    const maestroBin = yield* resolveMaestroBin(path);

    const targets: Platform[] =
      platform === 'both' ? ['ios', 'android'] : [platform];

    if (Option.isSome(device) && targets.length > 1) {
      return yield* ScreenshotError.make({
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
        docker: !noDocker,
        themes,
        device,
      });
    }

    // 6. Resize/derivative + fan-out (README/website variants + fastlane subset).
    if (!noDerive) {
      yield* deriveScreenshots({ repoRoot, screenshotsDir, path });
    }
  });

const parseThemes = (raw: Option.Option<string>): readonly ThemeId[] => {
  if (Option.isNone(raw)) return ALL_THEMES;
  const picked = Arr.filter(
    Arr.map(Str.split(raw.value, ','), Str.trim),
    (s): s is ThemeId => (ALL_THEMES as readonly string[]).includes(s),
  );
  return picked.length > 0 ? picked : ALL_THEMES;
};

const command = CliCommand.make(
  COMMAND_NAME,
  {
    platform: Flag.Literals('platform', ['ios', 'android', 'both']).pipe(
      Flag.withAlias('p'),
      Flag.withDefault('both' as const),
      Flag.withDescription('Platform(s) to capture'),
    ),
    skipBuild: Flag.Boolean('skip-build').pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        'Skip the Release build and reuse the installed seed build',
      ),
    ),
    skipKeychainReset: Flag.Boolean('skip-keychain-reset').pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        'iOS: do not reset the simulator keychain before capturing',
      ),
    ),
    noDocker: Flag.Boolean('no-docker').pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        'Do not spin up the temp sshd; use the rebex demo fallback',
      ),
    ),
    noDerive: Flag.Boolean('no-derive').pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        'Skip the resize/derivative + fastlane fan-out step',
      ),
    ),
    themes: Flag.String('themes').pipe(
      Flag.optional,
      Flag.withDescription(
        `Comma-separated theme subset (default: ${Arr.join(ALL_THEMES, ',')})`,
      ),
    ),
    device: Flag.String('device').pipe(
      Flag.withAlias('d'),
      Flag.optional,
      Flag.withDescription('Explicit device id/UDID (single --platform only)'),
    ),
  },
  ({
    platform,
    skipBuild,
    skipKeychainReset,
    noDocker,
    noDerive,
    themes,
    device,
  }) =>
    main(
      platform,
      skipBuild,
      skipKeychainReset,
      noDocker,
      noDerive,
      parseThemes(themes),
      device,
    ),
);

CliCommand.run(command, { version: '0.0.1' }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- script entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
