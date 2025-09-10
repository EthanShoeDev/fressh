// https://docs.expo.dev/guides/using-eslint/
import { createRequire } from 'node:module';
import { config as epicConfig } from '@epic-web/config/eslint';
import { defineConfig } from 'eslint/config';

const require = createRequire(import.meta.url);

const expoConfig = require('eslint-config-expo/flat');

// // Both epic and expo define a 'import' plugin (though not the same package)
// // We need to pick one or they will conflict.
const stripImportPlugin = (config) => {
	if (!config?.plugins?.['import']) return config;
	const { import: _removed, ...rest } = config.plugins;
	return {
		...config,
		plugins: rest,
	};
};

export default defineConfig([
	...expoConfig,
	...epicConfig.map(stripImportPlugin),
	{
		ignores: ['dist'],
	},
]);
