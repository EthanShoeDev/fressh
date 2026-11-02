#!/usr/bin/env bun
/**
 * Extract one version's section from CHANGELOG.md (written by changesets) into
 * the release-notes files the fastlane lanes consume:
 *
 *   build/release-notes.txt                                   (pilot what-to-test,
 *                                                              deliver What's New)
 *   fastlane/metadata/android/en-US/changelogs/<code>.txt     (Play release notes,
 *                                                              keyed by versionCode)
 *
 *   bun run changelog:extract                 # current package.json version
 *   bun run changelog:extract --version 0.2.0
 *
 * Effect-ts: same pattern as ./signed-build.ts.
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  String as Str,
} from 'effect';
import { Command as CliCommand, Flag } from 'effect/cli';

import packageJson from '../package.json' with { type: 'json' };

const COMMAND_NAME = 'changelog-extract';

class ChangelogError extends Schema.TaggedError<
  ChangelogError,
  { readonly brand: unique symbol }
>()('ChangelogError', { message: Schema.String }) {}

// MUST stay in sync with semverToCode in app.config.ts and version_code in
// fastlane/Fastfile. Operates on the stripped marketing version — changeset
// prerelease/snapshot suffixes ("-rc.0" / "-canary-abc") aren't part of the code.
const semverToCode = (version: string) => {
  const base = Str.split(version, '-')[0];
  const parts = Arr.map(Str.split(base, '.'), Number);
  const [maj, min, pat] = parts;
  if (
    parts.length !== 3 ||
    maj === undefined ||
    min === undefined ||
    pat === undefined ||
    Arr.some(parts, Number.isNaN)
  ) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return maj * 10_000 + min * 100 + pat;
};

// The Play changelog file is keyed by the uploaded versionCode. Canary/rc builds use
// a store-derived FRESSH_VERSION_CODE (see app.config.ts), so honor it here too so
// the changelog lands on the right code; stable falls back to semverToCode.
const versionCodeFor = (version: string) => {
  const override = process.env.FRESSH_VERSION_CODE;
  return override !== undefined && override !== ''
    ? Number.parseInt(override, 10)
    : semverToCode(version);
};

/**
 * changesets writes sections as `## <version>` followed by `### Minor Changes`
 * etc. Grab everything from this version's heading to the next `## ` heading.
 */
const extractSection = (changelog: string, version: string) => {
  const lines = Str.split(changelog, '\n');
  const startIndex = Arr.findFirstIndex(
    lines,
    (l) => Str.trim(l) === `## ${version}`,
  );
  if (Option.isNone(startIndex)) return undefined;
  const start = startIndex.value;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && Str.startsWith('## ')(line)) {
      end = i;
      break;
    }
  }
  return Str.trim(Arr.join(lines.slice(start + 1, end), '\n'));
};

const main = (versionFlag: Option.Option<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const version = Option.getOrElse(versionFlag, () => packageJson.version);
    const mobileDir = path.resolve(import.meta.dirname, '..');
    const changelogPath = path.join(mobileDir, 'CHANGELOG.md');

    const changelog = yield* fs.readFileString(changelogPath);
    const section = extractSection(changelog, version);
    // Canary/snapshot versions have no CHANGELOG section (nothing is committed for
    // them) — fall back to a stub. A STABLE version with no section is still an
    // error (changesets wasn't run).
    const isPrerelease = Str.includes('-')(version);
    if ((section === undefined || section === '') && !isPrerelease) {
      return yield* ChangelogError.make({
        message: `No "## ${version}" section in ${changelogPath}. Did changesets release this version?`,
      });
    }
    const body =
      section !== undefined && section.length > 0
        ? section
        : `Preview build ${version}`;

    // Play caps release notes at 500 chars; TestFlight at 4000. Trim for the
    // shared file and let the stores' generous side win.
    const notes = body.length > 480 ? `${Str.slice(0, 477)(body)}...` : body;

    const notesPath = path.join(mobileDir, 'build', 'release-notes.txt');
    const playPath = path.join(
      mobileDir,
      'fastlane/metadata/android/en-US/changelogs',
      `${versionCodeFor(version)}.txt`,
    );
    yield* fs.makeDirectory(path.dirname(notesPath), { recursive: true });
    yield* fs.writeFileString(notesPath, notes);
    yield* fs.writeFileString(playPath, notes);
    yield* Effect.log(`Release notes for ${version} -> ${notesPath}`);
    yield* Effect.log(`Play changelog -> ${playPath}`);
  });

const command = CliCommand.make(
  COMMAND_NAME,
  {
    version: Flag.String('version').pipe(
      Flag.withAlias('v'),
      Flag.optional,
      Flag.withDescription(
        'Version whose CHANGELOG section to extract (default: package.json version)',
      ),
    ),
  },
  ({ version }) => main(version),
);

CliCommand.run(command, { version: '0.0.1' }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- script entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
