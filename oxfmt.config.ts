import { defineConfig } from 'oxfmt';
import { defineShoemakerFormat } from 'shoemaker-oxfmt-config';

export default defineConfig(
  defineShoemakerFormat({
    tailwindStylesheet: './apps/web/src/styles/global.css',
    ignorePatterns: [
      // Design notes and reference clones; not project code.
      'docs/**',
      // Native projects: expo prebuild output and the terminal package's
      // Android/iOS glue are formatted by their own toolchains.
      '**/android/**',
      '**/ios/**',
      '**/.expo/**',
      // uniwind writes this from global.css on every Metro start.
      '**/uniwind-types.d.ts',
      // Rust workspace (cargo fmt owns it) and its build output.
      'packages/react-native-terminal/rust/**',
    ],
  }),
);
