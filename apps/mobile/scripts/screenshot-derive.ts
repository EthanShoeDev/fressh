#!/usr/bin/env bun
/**
 * Screenshot derivative + fan-out step (phase 6 of the screenshot pipeline).
 *
 * The raw Maestro captures in `packages/assets/mobile-screenshots/` are full-resolution
 * phone shots (~1200×2600, ~300–400 KB) — far heavier than the README needs and bigger
 * than the website wants. This step, run at the tail of `scripts/screenshots.ts` (or
 * standalone via `bun scripts/screenshot-derive.ts`):
 *
 *   1. emits a width-capped `small/` variant of every capture for the README/website
 *      using Bun's native image pipeline (`Bun.Image` — no sharp/imagemagick/jimp
 *      dependency; requires bun >= 1.3.14), and
 *   2. copies a curated store subset (one theme × the five hero screens) into fastlane's
 *      screenshot dirs, numbered `1.png`…`N.png` as `deliver`/`supply` expect.
 *
 * Captures are named `<screen>-<theme>-<platform>.png`; `<screen>` may itself contain a
 * hyphen (`smart-terminal`), so filenames are parsed RIGHT-to-left (platform, then theme,
 * then the remainder is the screen).
 *
 * Effect-ts: the FileSystem service (no node:fs) for directory/copy/remove, plus the
 * shared `app-themes` list (no re-declared theme ids).
 *
 * @see docs/projects/automated-screenshots-improvements.md
 */
import { Data, Effect, FileSystem, type Path } from 'effect';
import { APP_THEME_IDS } from '../src/lib/app-themes';

/** Theme ids — the single source of truth lives in `src/lib/app-themes.ts`. */
const THEMES = APP_THEME_IDS;
const PLATFORMS = ['ios', 'android'] as const;

/** Width (px) of the README/website `small/` variants. Phone shots are tall, so we cap
 *  the width and let the height fall out of the aspect ratio. */
const SMALL_WIDTH = 400;

/** The store listing wants a handful: one theme × the hero screens, in the same narrative
 *  order the website uses (servers → connect → the two terminal heroes → the rest),
 *  numbered 1.png…N.png. Full-resolution — `deliver`/`supply` size them. A screen with no
 *  capture for a platform (e.g. iOS has no `terminal`/`smart-terminal` shots — those are
 *  Android-only until a Mac run) is gracefully skipped, so that platform just gets fewer. */
const STORE_THEME = 'graphite';
const STORE_SCREENS = [
	'servers',
	'connect',
	'terminal',
	'smart-terminal',
	'keys',
	'commands',
	'settings',
] as const;

class DeriveError extends Data.TaggedError('DeriveError')<{
	readonly message: string;
}> {}

type Parsed = {
	readonly file: string;
	readonly screen: string;
	readonly theme: string | null;
	readonly platform: string;
};

/** Parse `<screen>-<theme>-<platform>.png` right-to-left so multi-word screens
 *  (`smart-terminal`) survive. Legacy `<screen>-<platform>.png` → theme = null. */
function parseName(file: string): Parsed | null {
	if (!file.endsWith('.png')) return null;
	const parts = file.slice(0, -'.png'.length).split('-');
	if (parts.length < 2) return null;
	const platform = parts.pop();
	if (
		platform === undefined ||
		!(PLATFORMS as readonly string[]).includes(platform)
	) {
		return null;
	}
	let theme: string | null = null;
	const maybeTheme = parts.at(-1);
	if (
		maybeTheme !== undefined &&
		(THEMES as readonly string[]).includes(maybeTheme)
	) {
		theme = maybeTheme;
		parts.pop();
	}
	if (parts.length === 0) return null;
	return { file, screen: parts.join('-'), theme, platform };
}

/** Fastlane screenshot dirs the stores read (per locale). */
const FASTLANE_DIRS = {
	ios: ['apps', 'mobile', 'fastlane', 'screenshots', 'en-US'],
	android: [
		'apps',
		'mobile',
		'fastlane',
		'metadata',
		'android',
		'en-US',
		'images',
		'phoneScreenshots',
	],
} as const;

/**
 * Width-cap one capture into `small/` with Bun's native image pipeline. A single-arg
 * `resize(width)` preserves the aspect ratio; `.png().write()` encodes + writes in one
 * off-thread step (no intermediate buffer).
 */
const writeSmall = (src: string, out: string) =>
	Effect.tryPromise({
		try: () => Bun.file(src).image().resize(SMALL_WIDTH).png().write(out),
		catch: (e) =>
			new DeriveError({ message: `resize ${src} failed: ${String(e)}` }),
	});

/**
 * Effect wrapper — composes into the screenshots pipeline's failure channel. Uses the
 * ambient FileSystem service (provided by `BunServices.layer` at the entrypoints).
 */
export const deriveScreenshots = (opts: {
	repoRoot: string;
	screenshotsDir: string;
	path: Path.Path;
}) =>
	Effect.gen(function* () {
		const { screenshotsDir, repoRoot, path } = opts;
		const fs = yield* FileSystem.FileSystem;

		// `small/` (a subdir) and any non-`.png` entry parse to null and drop out, so a
		// plain name listing is enough — no need to stat each entry for file-ness.
		const captures = (yield* fs.readDirectory(screenshotsDir))
			.map(parseName)
			.filter((p): p is Parsed => p !== null);

		if (captures.length === 0) {
			console.warn(`derive: no captures found in ${screenshotsDir}`);
			return;
		}

		// 1. Width-capped small/ variants for the README + website.
		const smallDir = path.join(screenshotsDir, 'small');
		yield* fs.makeDirectory(smallDir, { recursive: true });
		for (const cap of captures) {
			yield* writeSmall(
				path.join(screenshotsDir, cap.file),
				path.join(smallDir, cap.file),
			);
		}
		console.log(
			`derive: wrote ${captures.length} small variants → ${path.join('small')}`,
		);

		// 2. Store subset into fastlane (one theme × the hero screens, per platform).
		for (const platform of PLATFORMS) {
			const ordered = STORE_SCREENS.map((screen) =>
				captures.find(
					(c) =>
						c.screen === screen &&
						c.theme === STORE_THEME &&
						c.platform === platform,
				),
			).filter((c): c is Parsed => c !== undefined);

			if (ordered.length === 0) continue;

			const destDir = path.join(repoRoot, ...FASTLANE_DIRS[platform]);
			yield* fs.makeDirectory(destDir, { recursive: true });
			// Clear stale numbered shots (keep .gitkeep) so a re-run doesn't leave orphans.
			const existing = yield* fs
				.readDirectory(destDir)
				.pipe(Effect.orElseSucceed(() => [] as Array<string>));
			for (const e of existing) {
				if (/^\d+\.png$/.test(e)) yield* fs.remove(path.join(destDir, e));
			}
			let n = 1;
			for (const cap of ordered) {
				yield* fs.copyFile(
					path.join(screenshotsDir, cap.file),
					path.join(destDir, `${n}.png`),
				);
				n++;
			}
			console.log(
				`derive: copied ${ordered.length} ${STORE_THEME} ${platform} shots → ${path.join(...FASTLANE_DIRS[platform])}`,
			);
		}
	}).pipe(
		// Keep the failure channel a single tagged error (FileSystem ops fail with
		// PlatformError; the resize step already fails with DeriveError).
		Effect.mapError((e) =>
			e instanceof DeriveError
				? e
				: new DeriveError({ message: `derive failed: ${String(e)}` }),
		),
	);

// ---------------------------------------------------------------------------
// Standalone CLI: `bun scripts/screenshot-derive.ts` (re-derive without recapturing).
// ---------------------------------------------------------------------------
if (import.meta.main) {
	const { BunRuntime, BunServices } = await import('@effect/platform-bun');
	const { Path } = await import('effect');
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const scriptDir = import.meta.dirname;
		const repoRoot = path.resolve(scriptDir, '..', '..', '..');
		const screenshotsDir = path.resolve(
			repoRoot,
			'packages',
			'assets',
			'mobile-screenshots',
		);
		yield* deriveScreenshots({ repoRoot, screenshotsDir, path });
	}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
}
