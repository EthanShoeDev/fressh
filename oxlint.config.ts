import { defineConfig } from 'oxlint';
import { defineShoemakerConfig } from 'shoemaker-oxlint-config';

export default defineConfig(
  defineShoemakerConfig({
    scope: 'fressh',
    react: true,
    tanstackRouter: true,
    web: true,
    ignorePatterns: [
      // Design notes and reference clones; not project code.
      'docs/**',
      // Native projects: expo prebuild output and the terminal package's
      // hand-written Android/iOS glue are not JS.
      '**/android/**',
      '**/ios/**',
      // Expo's generated route types and env shim.
      '**/.expo/**',
      '**/expo-env.d.ts',
      // uniwind writes this from global.css on every Metro start.
      '**/uniwind-types.d.ts',
    ],
    rules: {
      // This is an SSH/terminal app: bitwise ops on bytes (control-key
      // folding, masks) are a core, intentional pattern.
      'no-bitwise': 'off',
      // Its autofix rewrites `.sort()` to `.toSorted()`, which (ES2023) is not
      // reliably present in Hermes and throws at runtime; we copy before
      // sorting where mutation matters.
      'unicorn/no-array-sort': 'off',
    },
    overrides: [
      {
        // Nitro spec files must use method signatures (`foo(): void`) so
        // nitrogen tells HybridView/HybridObject methods from props.
        files: ['**/*.nitro.ts'],
        rules: {
          'typescript/method-signature-style': 'off',
          // A HybridView spec needs a methods interface even with no methods.
          'typescript/no-empty-interface': 'off',
          // Same reason: the empty methods interface is nitro's required shape.
          'typescript/no-empty-object-type': 'off',
        },
      },
      {
        // The marketing site and the published terminal package carry no
        // effect dependency, so effect/Array, effect/String, effect/Record
        // and effect/Schema are not there to use.
        files: ['apps/web/**', 'packages/react-native-terminal/**'],
        rules: {
          // Native array methods are all there is without effect/Array.
          'effecttsgo/prefer-effect-array': 'off',
          // Native string methods are all there is without effect/String.
          'effecttsgo/prefer-effect-string': 'off',
          // Native Object.keys/entries are all there is without effect/Record.
          'effecttsgo/prefer-effect-record': 'off',
          // `typeof` is the only narrowing available without effect/Schema.
          'anti-slop/no-runtime-typeof': 'off',
        },
      },
      {
        // React Native CLI and Babel `require()` these configs, so they stay
        // CommonJS JavaScript.
        files: ['**/react-native.config.js', '**/babel.config.cjs'],
        rules: {
          // The loaders require() them; ESM is not an option.
          'import/no-commonjs': 'off',
          // Same reason: CommonJS module, not ESM.
          'unicorn/prefer-module': 'off',
          // Same reason: CommonJS module, not ESM.
          'import/unambiguous': 'off',
          // Same reason: require() is how CommonJS imports.
          'typescript/no-require-imports': 'off',
          // Same reason: require() is how CommonJS imports.
          'typescript/no-var-requires': 'off',
          // Untyped JS: require() results are `any` to the type-aware rules.
          'typescript/no-unsafe-assignment': 'off',
          // Same reason: calls on untyped require() results.
          'typescript/no-unsafe-call': 'off',
          // Same reason: member access on untyped require() results.
          'typescript/no-unsafe-member-access': 'off',
        },
      },
    ],
  }),
);
