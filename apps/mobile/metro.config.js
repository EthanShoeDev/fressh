// Learn more: https://docs.expo.dev/guides/customizing-metro
// ESM config: apps/mobile is "type": "module", so this file must use import/export
// (a CommonJS metro.config.js fails to load under EAS Build / eas-cli config resolution).
import { getDefaultConfig } from 'expo/metro-config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withUniwindConfig } from 'uniwind/metro';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
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
