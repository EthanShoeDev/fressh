// Learn more: https://docs.expo.dev/guides/customizing-metro
// ESM config: apps/mobile is "type": "module", so a CommonJS metro.config.js
// fails to load under eas build / eas-cli (loaded as ESM -> "require is not
// defined"). But `expo/metro-config` and `uniwind/metro` are CommonJS and are
// NOT resolvable as ESM bare specifiers when Node's import() loads this file
// (eas build does exactly that). So keep the file ESM but pull those CJS deps in
// via createRequire — CJS resolution handles their subpaths/exports correctly.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

// Cast: this .js file is type-checked without bun-types, so import.meta.dirname
// (Node >=20.11 / bun, what eas-cli's import() runs under) is unknown to it.
const projectRoot = /** @type {string} */ (import.meta.dirname);
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo resolution: watch the workspace root and resolve modules from both
// the app's and the workspace's node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
	path.join(projectRoot, 'node_modules'),
	path.join(workspaceRoot, 'node_modules'),
];

// REQUIRED: Effect v4 ships deep subpath exports (e.g. `effect/Schema`,
// `effect/unstable/reactivity/Atom`) that only resolve via package `exports`.
// Owning metro.config means we must keep this on explicitly.
config.resolver.unstable_enablePackageExports = true;

// Don't watch Rust build output. `cargo`/`cargo-ndk` constantly create and delete
// transient archives under `packages/*/rust/target`, and Metro's (watchman-less)
// fallback file watcher crashes with ENOENT when those temp files vanish mid-walk
// — which silently kills the dev server during native rebuilds. Exclude it.
const rustTargetRE = /[\\/]rust[\\/]target[\\/].*/;
config.resolver.blockList = config.resolver.blockList
	? [].concat(config.resolver.blockList, rustTargetRE)
	: [rustTargetRE];

// `withUniwindConfig` must be the OUTERMOST wrapper.
export default withUniwindConfig(config, {
	cssEntryFile: './src/global.css',
	dtsFile: './src/uniwind-types.d.ts',
	// `native` + `native-light` back the system-following "Native" theme (the app
	// stores `native`; the device color scheme picks the variant at runtime).
	extraThemes: [
		'phosphor',
		'graphite',
		'aurora',
		'monolith',
		'native',
		'native-light',
	],
});
