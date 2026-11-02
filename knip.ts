import { defineKnipConfig } from 'shoemaker-knip-config';

export default defineKnipConfig({
  ignore: [
    // Design notes and reference clones; not project code.
    'docs/**',
  ],
  ignoreBinaries: [
    // Provided by the nix dev shell, not npm.
    'cargo',
    'cargo-ndk',
    'ubrn',
    'just',
    'maestro',
    'fastlane',
    'adb',
  ],
  workspaces: {
    '.': {
      // Root scripts run by path.
      entry: ['*.ts', 'scripts/**/*.ts'],
      // Named in `types` by shoemaker-typescript-config's base tsconfig, which
      // knip does not follow into node_modules.
      ignoreDependencies: ['bun-types'],
    },
    'apps/mobile': {
      // app.config.ts points at the shared icons and splash images by path.
      ignoreDependencies: ['@fressh/assets'],
    },
    'packages/react-native-terminal': {
      // nitrogen reads the specs and generates the native bindings from them.
      entry: ['nitro/**/*.nitro.ts'],
      // Imported only by the ubrn-generated bindings (src/generated, ignored).
      ignoreDependencies: ['@ubjs/core'],
    },
    'apps/web': {
      // shadcn-vendored primitives keep their full export surface even when
      // the site only uses part of it.
      ignore: ['src/components/ui/**'],
    },
  },
});
