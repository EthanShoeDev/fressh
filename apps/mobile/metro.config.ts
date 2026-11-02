// Learn more: https://docs.expo.dev/guides/customizing-metro
// Expo compiles TS metro configs to CommonJS, so `__dirname` (not
// `import.meta`) is what exists at load time.
import fs from 'node:fs';
import path from 'node:path';

import { FileStore } from '@expo/metro-config/file-store';
import * as Arr from 'effect/Array';
import { getDefaultConfig, type MetroConfig } from 'expo/metro-config';
import { getBundleModeMetroConfig } from 'react-native-worklets/bundleMode';
import { withUniwindConfig } from 'uniwind/metro';

// oxlint-disable-next-line unicorn/prefer-module -- Expo compiles this file to CommonJS; import.meta would make Node reload it as ESM and fail
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// Worklets Bundle Mode (react-native-effects' off-thread render loop runs on a
// worklet runtime that loads a real bundle). Pairs with babel.config.cjs
// (`bundleMode: true`) and the metro patches in docs/bun-patches.md. The helper
// wraps getTransformOptions itself (adding the `inlineRequires: true` Bundle
// Mode requires) and chains resolveRequest, which uniwind chains in turn.
// SAFETY: the helper's .d.ts declares no parameters and returns `any`; at
// runtime it takes the Expo config and returns that same config, extended.
const withBundleMode = getBundleModeMetroConfig as (
  config: MetroConfig,
) => MetroConfig;
const base = withBundleMode(getDefaultConfig(projectRoot));

// Don't watch Rust build output. `cargo`/`cargo-ndk` constantly create and delete
// transient archives under `packages/*/rust/target`, and Metro's (watchman-less)
// fallback file watcher crashes with ENOENT when those temp files vanish mid-walk
// — which silently kills the dev server during native rebuilds. Exclude it.
// No regex flags: Metro merges every blockList pattern into one RegExp and
// rejects mixed flags (Expo's default patterns have none).
const rustTargetRE = /[\\/]rust[\\/]target[\\/].*/;

// Keep Metro's caches INSIDE the repo so `git clean -fxd` actually clears them.
// Both default to `os.tmpdir()/metro-cache` (and `os.tmpdir()` for the file map),
// which under nix-shell is `/tmp/nix-shell.XXXX/…` — outside the tree, so a repo
// clean leaves stale transform results behind that reference now-deleted generated
// files (e.g. worklets Bundle Mode's `.worklets/<id>.js`), giving ENOENT bundling
// errors. `node_modules/.cache` is git-ignored and removed by `git clean -fxd`, so
// the cache lifecycle now matches the rest of node_modules.
const metroCacheRoot = path.join(
  workspaceRoot,
  'node_modules',
  '.cache',
  'metro',
);
const transformCacheDir = path.join(metroCacheRoot, 'transform');
const fileMapCacheDir = path.join(metroCacheRoot, 'file-map');
// Pre-create both dirs: the transform FileStore mkdirs on its own, but
// @expo/metro-file-map's DiskCacheManager writes the cache file without creating
// its parent (it always assumed the pre-existing os.tmpdir()), so a fresh repo
// would ENOENT on first cache write.
fs.mkdirSync(transformCacheDir, { recursive: true });
fs.mkdirSync(fileMapCacheDir, { recursive: true });

const config: MetroConfig = {
  ...base,
  // Monorepo resolution: watch the workspace root and resolve modules from
  // both the app's and the workspace's node_modules.
  watchFolders: [workspaceRoot],
  resolver: {
    ...base.resolver,
    nodeModulesPaths: [
      path.join(projectRoot, 'node_modules'),
      path.join(workspaceRoot, 'node_modules'),
    ],
    // Effect v4 ships deep subpath exports (e.g. `effect/Schema`,
    // `effect/reactivity/Atom`) that only resolve via package `exports`.
    unstable_enablePackageExports: true,
    blockList: [
      ...(base.resolver?.blockList === undefined
        ? []
        : Arr.ensure(base.resolver.blockList)),
      rustTargetRE,
    ],
  },
  cacheStores: [new FileStore({ root: transformCacheDir })],
  fileMapCacheDirectory: fileMapCacheDir,
};

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
