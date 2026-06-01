import { defineConfig } from 'oxlint';

// Inlined from the rule sets that ultracite previously provided via
// `extends` (ultracite/config/oxlint/core and .../react). We dropped the
// ultracite dependency and now own this config directly. Authored as TS so
// knip can trace the jsPlugins workspace deps (its oxlint plugin can't
// resolveConfig on JSONC).
export default defineConfig({
	plugins: [
		// Core (formerly ultracite core)
		'eslint',
		'typescript',
		'unicorn',
		'oxc',
		'import',
		'jsdoc',
		'node',
		'promise',
		'jest',
		'vitest',
		// React (formerly ultracite react)
		'react',
		'react-perf',
		'jsx-a11y',
	],
	jsPlugins: [
		'@fressh/oxlint-plugins/require-disable-description',
		'@fressh/oxlint-plugins/require-unknown-cast-comment',
	],
	env: {
		browser: true,
	},
	categories: {
		correctness: 'error',
		perf: 'error',
		restriction: 'error',
		suspicious: 'error',
		pedantic: 'error',
		style: 'error',
	},
	ignorePatterns: [
		'docs/**',
		'docs/cloned-repos-as-docs/**',
		'submodules/**',
		'.sst/**',
		'**/.nitro/**',
		'**/dist/**',
		'**/dist-internal/**',
		'**/lib/**',
		'**/.expo/**',
		'**/android/**',
		'**/ios/**',
		'**/*.gen.*',
		'**/*.snapshot.json',
		'**/*.vendored.*',
		'**/*.hbs',
		'**/routeTree.gen.ts',
		'**/sst-env.d.ts',
		'**/uniwind-types.d.ts',
		'apps/start/src/seo/cookie-trackers/**/*.js',
		'infra/grafana/dashboards/**',
		'CLAUDE.md',
		'.agents/**',
		'.claude/skills/**',
		'.cursor/**',
		'.opencode/**',
		'.github/skills/**',
		'*-playground.html',
	],
	/*
	 * When we deviate from the defaults, we should add some comment explaining why.
	 * Do not delete the comments, and do not add a rule without a comment.
	 */
	rules: {
		// ─── Core defaults (formerly ultracite core) ────────────────────────
		'no-await-in-loop': 'off',
		'max-lines-per-function': 'off',
		'no-implicit-coercion': 'off',
		'no-magic-numbers': 'off',
		'no-ternary': 'off',
		'no-undefined': 'off',
		'max-lines': 'off',
		'id-length': 'off',
		'max-depth': 'off',
		'max-params': 'off',
		'capitalized-comments': 'off',
		'new-cap': 'off',
		// Incompatible with Effect.gen generators — yield* as last expression is the
		// return value, but oxlint sees it as missing a return. oxc-project/oxc#21159.
		'typescript/consistent-return': 'off',
		'no-continue': 'off',
		'init-declarations': 'off',
		// Rely on oxfmt experimentalSortImports instead
		'sort-imports': 'off',
		'import/no-default-export': 'off',
		'import/exports-last': 'off',
		'import/no-named-export': 'off',
		'import/max-dependencies': 'off',
		'import/extensions': 'off',
		'import/no-namespace': 'off',
		'import/no-anonymous-default-export': 'off',
		'import/prefer-default-export': 'off',
		'import/group-exports': 'off',
		'import/no-commonjs': 'off',
		'import/unambiguous': 'off',
		'import/no-dynamic-require': 'off',
		'import/no-unassigned-import': 'off',
		// Generated/dynamic namespaces can't be resolved by eslint-plugin-import;
		// TypeScript validates call sites.
		'import/namespace': 'off',
		'jsdoc/require-param': 'off',
		'jsdoc/require-returns': 'off',
		'unicorn/custom-error-definition': 'off',
		'unicorn/explicit-length-check': 'off',
		'unicorn/no-array-callback-reference': 'off',
		'unicorn/no-process-exit': 'off',
		'unicorn/prefer-global-this': 'off',
		'unicorn/no-null': 'off',
		'unicorn/prefer-top-level-await': 'off',
		'unicorn/prefer-string-raw': 'off',
		// Too strict — flags valid patterns like `const [value] = useState(init)`
		// (no setter needed) and passing full useState tuples as props.
		'react/hook-use-state': 'off',
		'typescript/explicit-module-boundary-types': 'off',
		'typescript/no-require-imports': 'off',
		'typescript/explicit-function-return-type': 'off',
		'typescript/no-var-requires': 'off',
		'typescript/require-await': 'off',
		'node/no-process-env': 'off',
		'oxc/no-map-spread': 'off',
		'oxc/no-async-await': 'off',
		'oxc/no-rest-spread-properties': 'off',
		'oxc/no-optional-chaining': 'off',
		'promise/catch-or-return': 'off',
		'promise/always-return': 'off',

		// ─── React defaults (formerly ultracite react) ──────────────────────
		'react/only-export-components': 'off',
		'react/jsx-boolean-value': 'off',
		'react/react-in-jsx-scope': 'off',
		'react/jsx-filename-extension': 'off',
		'react/no-unknown-property': 'off',
		'react/jsx-props-no-spreading': 'off',
		'react/jsx-max-depth': 'off',
		'react/no-multi-comp': 'off',
		'react-perf/jsx-no-jsx-as-prop': 'off',
		'react-perf/jsx-no-new-object-as-prop': 'off',
		'react-perf/jsx-no-new-array-as-prop': 'off',
		'jsx-a11y/no-autofocus': 'off',

		// ─── Project overrides ──────────────────────────────────────────────
		// Require description on eslint-disable comments (custom jsPlugin)
		'disable-comments/require-description': 'error',
		// Require an explanatory comment on `as unknown as` casts (custom jsPlugin)
		'unknown-cast/require-comment': 'error',
		// Breaks effect-ts code that uses thisArg in array methods.
		'unicorn/no-array-method-this-argument': 'off',
		// Limits classes per file (default 1), too restrictive for our patterns.
		'max-classes-per-file': 'off',
		// Requires setup/teardown in Jest hooks, not at top level.
		'jest/require-hook': 'off',
		// Requires named function expressions for stack traces.
		'func-names': 'off',
		// Disallows TODO/FIXME comments; we use these intentionally.
		'no-warning-comments': 'off',
		// Limits statements per function (default 10), too restrictive.
		'max-statements': 'off',
		// Forbids Array#forEach; we use it where appropriate.
		'no-array-for-each': 'off',
		// Disallows nested ternaries; sometimes they are the clearest option.
		'no-nested-ternary': 'off',
		// Unicorn variant of nested ternary rule.
		'unicorn/no-nested-ternary': 'off',
		// Disallows non-boolean in conditions; too strict with Effect-TS Option types.
		'strict-boolean-expressions': 'off',
		// Requires async on Promise-returning functions; conflicts with Effect patterns.
		'typescript/promise-function-async': 'off',
		// Disallows narrowing type assertions; sometimes necessary with external libs.
		'typescript/no-unsafe-type-assertion': 'off',
		// Requires require() at top-level conflicts with jest.mock patterns.
		'node/global-require': 'off',
		// Prevents inline functions in JSX props; too strict.
		'react-perf/jsx-no-new-function-as-prop': 'off',
		// Enforces function declarations vs expressions; we use both.
		'func-style': 'off',
		// Moves functions to outer scope; breaks desired closures.
		'unicorn/consistent-function-scoping': 'off',
		// Requires escaping >, <, & in JSX; React handles this.
		'react/no-unescaped-entities': 'off',
		// Alphabetical sorting fights with logical grouping.
		'sort-keys': 'off',
		// Barrel files are a common pattern, threshold too low.
		'oxc/no-barrel-file': 'off',
		// Inline type imports can leave empty side-effect imports.
		'typescript/no-import-type-side-effects': 'error',
		// Enforces array type syntax; we use both Array<T> and T[].
		'typescript/array-type': 'off',
		// Conflicts with import/consistent-type-specifier-style for type re-exports.
		'no-duplicate-imports': 'off',
		// Forbids ++ operator; we use it in loops.
		'no-plusplus': 'off',
		// This is an SSH/terminal app — bitwise ops on bytes (control-key folding,
		// masks) are a core, intentional pattern.
		'no-bitwise': 'off',
		// Prevents comments on same line as code; we use these sparingly.
		'no-inline-comments': 'off',
		// Requires curly braces for if statements; single-line returns are sometimes clearer.
		curly: 'off',
		// Allow void as statement expression to explicitly discard promises.
		'no-void': ['error', { allowAsStatement: true }],
		// TanStack Router uses throw redirect() as control flow.
		'only-throw-error': 'off',
		// Label wrapper components can false-positive this rule.
		'jsx-a11y/label-has-associated-control': 'off',
		// False positives on Zod's .catch() method.
		'promise/prefer-await-to-then': 'off',
		// False positives on Zod's .catch() method.
		'promise/valid-params': 'off',
		// Requires braces around switch case blocks; unnecessary verbosity here.
		'no-case-declarations': 'off',
		// Enforces interface over type; we use both.
		'typescript/consistent-type-definitions': 'off',
		// Allow async functions in JSX attributes.
		'typescript/no-misused-promises': [
			'error',
			{
				checksVoidReturn: {
					attributes: false,
				},
			},
		],
		// Commented-out tests are sometimes useful for reference/debugging.
		'jest/no-commented-out-tests': 'off',
		// Skipped tests are intentional in some scenarios.
		'jest/no-disabled-tests': 'off',
		// `string & {}` preserves autocomplete while allowing any string.
		'typescript/ban-types': 'off',
		// Empty interfaces are used for module augmentation.
		'typescript/no-empty-object-type': 'off',
		// False positives with const/let in for...of loops.
		'no-loop-func': 'off',
		// Conflicts with useRef<T>(undefined) and Zod .catch(undefined).
		'unicorn/no-useless-undefined': 'off',
		// concat() can outperform spread in some cases.
		'unicorn/prefer-spread': 'off',
		// Array.reduce is a valid functional pattern.
		'unicorn/no-array-reduce': 'off',
		// new Promise() is valid for callback wrapping.
		'promise/avoid-new': 'off',
		// We use TypeScript for types, not JSDoc.
		'jsdoc/require-param-type': 'off',
		// Test hooks are a valid pattern.
		'jest/no-hooks': 'off',
		// Arbitrary limit on expects per test.
		'jest/max-expects': 'off',
		// Arbitrary complexity limit is handled in code review.
		complexity: 'off',
		// Conditionals in tests are valid for parameterized behavior.
		'jest/no-conditional-in-test': 'off',
		// Not all tests need top-level describe blocks.
		'jest/require-top-level-describe': 'off',
		// Conditional expects are valid in some test patterns.
		'jest/no-conditional-expect': 'off',
		// False positives with Effect-TS it.scoped + Effect.gen patterns.
		'jest/no-standalone-expect': 'off',
		// Destructuring is not always clearer than property access.
		'prefer-destructuring': 'off',
		// Tests can rely on implicit assertions or alternative helpers.
		'jest/expect-expect': 'off',
		// Effect-TS service classes often use methods without `this`.
		'class-methods-use-this': 'off',
		// Dynamic test names via variables are valid.
		'jest/valid-title': 'off',
		// lo/hi naming in binary search is conventional.
		'sort-vars': 'off',
		// JSDoc inline param descriptions are readable enough.
		'jsdoc/require-param-description': 'off',
		// False positives from plain comment text.
		'jsdoc/check-property-names': 'off',
		// Conditional incremental push() patterns are valid.
		'unicorn/no-immediate-mutation': 'off',
		// False positives from scoped package names in comments.
		'jsdoc/check-tag-names': 'off',
		// Test files can export shared config/utilities.
		'jest/no-export': 'off',
		// Render props (children as function) are valid.
		'react/no-children-prop': 'off',
		// Empty interfaces extending others are valid for declaration merging.
		'typescript/no-empty-interface': 'off',
		// Vitest mock typing can trigger false positives.
		'jest/no-untyped-mock-factory': 'off',
		// Common React callback patterns trigger noisy false positives.
		'typescript/no-confusing-void-expression': 'off',
		// Acronyms in component names are intentionally uppercase.
		'react/jsx-pascal-case': 'off',
		// Passing service methods directly as handlers is acceptable.
		'react/jsx-handler-names': 'off',
		// for...of can be clearer than it.each in complex tests.
		'jest/prefer-each': 'off',
		// File naming varies by convention.
		'unicorn/filename-case': 'off',
		// `if (!x)` is often clearer than inverted branches.
		'no-negated-condition': 'off',
		// Test naming conventions vary by project.
		'vitest/consistent-test-filename': 'off',
		// We intentionally import vitest APIs explicitly.
		'vitest/no-importing-vitest-globals': 'off',
		// prefer-import-in-mock currently conflicts with our typings.
		'vitest/prefer-import-in-mock': 'off',
		// This repo intentionally uses declarations after route/config declarations.
		'no-use-before-define': 'off',
		// Monorepo packages/scripts import from parent folders by design.
		'import/no-relative-parent-imports': 'off',
		// Node builtins are expected in server/config/script code.
		'import/no-nodejs-modules': 'off',
		// Common short names in callbacks are acceptable.
		'no-shadow': 'off',
		// __dirname is still used in some tool configs.
		'unicorn/prefer-module': 'off',
		// if/else is often clearer than ternary in scripts.
		'unicorn/prefer-ternary': 'off',
		// Existing React code intentionally uses index keys in some lists.
		'react/no-array-index-key': 'off',
		// Context value memoization is handled case-by-case.
		'react/jsx-no-constructed-context-values': 'off',
		// Constructor parameter properties are a valid TS style.
		'typescript/parameter-properties': 'off',
		// Void-in-type positions can be useful for interop and utilities.
		'typescript/no-invalid-void-type': 'off',
		// Callbacks are valid for event handlers and streams.
		'promise/prefer-await-to-callbacks': 'off',
		// Role attributes can be necessary for complex components.
		'jsx-a11y/prefer-tag-over-role': 'off',
		// Conflicts with oxfmt output (`import { type X }`).
		'typescript/consistent-type-imports': 'off',
		// Conflicts with oxfmt.
		'import/consistent-type-specifier-style': 'off',
		// Conflicts with oxfmt lowercasing hex literals.
		'unicorn/number-literal-case': 'off',
		// We use TypeScript for types, not JSDoc.
		'jsdoc/require-property-type': 'off',
		// We use TypeScript for types, not JSDoc.
		'jsdoc/require-returns-type': 'off',
		// Both arrow body styles are valid depending on context.
		'arrow-body-style': 'off',
		// Numeric separators are stylistic preference.
		'unicorn/numeric-separators-style': 'off',
		// Minor test style preference.
		'vitest/prefer-to-be-truthy': 'off',
		// Minor test style preference.
		'vitest/prefer-to-be-falsy': 'off',
		// Console logging should go through Effect.log* by default.
		'no-console': 'error',
		// TODO: Remove this eventually.
		'no-deprecated': 'off',
		// Existing code intentionally uses direct node: imports.
		'unicorn/prefer-node-protocol': 'off',
		// Existing binary/text handling uses this casing.
		'unicorn/text-encoding-identifier-case': 'off',
		// Existing code paths are not fully migrated off unsafe type flows.
		'typescript/no-unsafe-assignment': 'off',
		// Existing code paths are not fully migrated off unsafe type flows.
		'typescript/no-unsafe-member-access': 'off',
		// Existing code paths are not fully migrated off unsafe type flows.
		'typescript/no-unsafe-call': 'off',
		// Existing code paths are not fully migrated off unsafe type flows.
		'typescript/no-unsafe-return': 'off',
	},
	overrides: [
		{
			// Mock callbacks/factories in test files need looser rules.
			files: [
				'**/*.{test,spec}.{ts,tsx,js,jsx}',
				'**/__tests__/**/*.{ts,tsx,js,jsx}',
			],
			rules: {
				'no-empty-function': 'off',
				'promise/prefer-await-to-then': 'off',
			},
		},
		{
			files: ['**/scripts/*.ts', '**/scripts/**/*.ts'],
			rules: {
				'jest/require-hook': 'off',
				'unicorn/text-encoding-identifier-case': 'off',
				'typescript/no-unsafe-assignment': 'off',
				'typescript/no-unsafe-member-access': 'off',
				'typescript/no-unsafe-call': 'off',
				'typescript/no-unsafe-return': 'off',
				'unicorn/prefer-node-protocol': 'off',
				'no-void': 'off',
				'prefer-destructuring': 'off',
				// Build/CLI scripts legitimately log to the console.
				'no-console': 'off',
			},
		},
		{
			// Build/release tooling: release-it config uses literal `${...}`
			// placeholders in plain strings, and config/dev entrypoints log.
			files: [
				'**/.release-it.ts',
				'**/*.config.ts',
				'**/*.config.*.ts',
				'**/src-internal/**',
			],
			rules: {
				'no-template-curly-in-string': 'off',
				'no-console': 'off',
			},
		},
	],
});
