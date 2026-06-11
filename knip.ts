import type { KnipConfig } from 'knip';

const config: KnipConfig = {
	// Deps referenced as strings in configs, not via static imports.
	ignoreDependencies: [
		// knip's oxlint plugin doesn't run resolveConfig on TS configs (only
		// JSON), so it can't detect the jsPlugins references in oxlint.config.ts.
		'@fressh/oxlint-plugins', // oxlint.config.ts jsPlugins
		'eslint', // peer of @fressh/oxlint-plugins (Rule types used at lint time)
		'@effect/language-service', // tsconfig plugin embedded by @effect/tsgo
		'@effect/tsgo', // patches @typescript/native-preview via the prepare script
	],
	workspaces: {
		'apps/mobile': {
			// `bun test` suites (no test-framework plugin claims them as entries).
			entry: ['src/**/*.test.ts'],
		},
	},
};

export default config;
