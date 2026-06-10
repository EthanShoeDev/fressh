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
import { Data, Effect, FileSystem, Option, Path } from 'effect';
import { Command as CliCommand, Flag } from 'effect/unstable/cli';
import packageJson from '../package.json' with { type: 'json' };

const COMMAND_NAME = 'changelog-extract';

class ChangelogError extends Data.TaggedError('ChangelogError')<{
	message: string;
}> {}

// MUST stay in sync with semverToCode in app.config.ts and version_code in
// fastlane/Fastfile (versionCode derived from the package.json semver).
const semverToCode = (version: string) => {
	const parts = version.split('.').map(Number);
	const [maj, min, pat] = parts;
	if (
		parts.length !== 3 ||
		maj === undefined ||
		min === undefined ||
		pat === undefined ||
		parts.some(Number.isNaN)
	) {
		throw new Error(`Invalid semver: ${version}`);
	}
	return maj * 10_000 + min * 100 + pat;
};

/**
 * changesets writes sections as `## <version>` followed by `### Minor Changes`
 * etc. Grab everything from this version's heading to the next `## ` heading.
 */
const extractSection = (changelog: string, version: string) => {
	const lines = changelog.split('\n');
	const start = lines.findIndex((l) => l.trim() === `## ${version}`);
	if (start === -1) return undefined;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && line.startsWith('## ')) {
			end = i;
			break;
		}
	}
	return lines
		.slice(start + 1, end)
		.join('\n')
		.trim();
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
		if (!section) {
			return yield* new ChangelogError({
				message: `No "## ${version}" section in ${changelogPath}. Did changesets release this version?`,
			});
		}

		// Play caps release notes at 500 chars; TestFlight at 4000. Trim for the
		// shared file and let the stores' generous side win.
		const notes =
			section.length > 480 ? `${section.slice(0, 477)}...` : section;

		const notesPath = path.join(mobileDir, 'build', 'release-notes.txt');
		const playPath = path.join(
			mobileDir,
			'fastlane/metadata/android/en-US/changelogs',
			`${semverToCode(version)}.txt`,
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
		version: Flag.string('version').pipe(
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
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
