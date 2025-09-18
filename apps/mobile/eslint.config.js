// https://docs.expo.dev/guides/using-eslint/
import { createRequire } from 'node:module';
import { config as epicConfig } from '@epic-web/config/eslint';
import eslint from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import react from '@eslint-react/eslint-plugin';
import pluginQuery from '@tanstack/eslint-plugin-query';
import * as tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import eslintReact from 'eslint-plugin-react';
import pluginReactCompiler from 'eslint-plugin-react-compiler';
import hooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const require = createRequire(import.meta.url);

const expoConfig = require('eslint-config-expo/flat');

// Several presets define the same plugin keys which causes conflicts in ESLint flat config
// (e.g. 'import' from different packages, and '@typescript-eslint').
// Remove conflicting plugins from upstream presets so we can control which wins.
const stripPlugins = (config, names) => {
	if (!config?.plugins) return config;
	const plugins = { ...config.plugins };
	let changed = false;
	for (const name of names) {
		if (plugins[name]) {
			delete plugins[name];
			changed = true;
		}
	}
	return changed ? { ...config, plugins } : config;
};

export default defineConfig([
	// Expo (strip conflicting plugins defined elsewhere)
	...expoConfig.map((c) => stripPlugins(c, ['@typescript-eslint'])),
	// Epic (strip conflicting plugins defined elsewhere)
	...epicConfig.map((c) => stripPlugins(c, ['import'])),

	// ts-eslint
	eslint.configs.recommended,

	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	// tanstack query
	...pluginQuery.configs['flat/recommended'],

	// @eslint-react/eslint-plugin (smaller version of eslint-plugin-react)
	{
		files: ['**/*.{ts,tsx}'],
		...react.configs['recommended-type-checked'],
		languageOptions: {
			parser: tsParser,
		},
	},

	// Lint eslint disable comments
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- no types
	comments.recommended,

	// eslint-plugin-react
	// Terrible flat config support
	{
		...eslintReact.configs.flat.recommended,
		files: ['**/*.{ts,tsx}'],
		settings: { react: { version: 'detect' } },
		languageOptions: {
			...eslintReact.configs.flat.recommended?.languageOptions,
			globals: {
				...globals.serviceworker,
				...globals.browser,
			},
		},
		plugins: {
			...eslintReact.configs.flat.recommended?.plugins,
			'react-hooks': hooksPlugin,
			'react-compiler': pluginReactCompiler,
		},
		rules: {
			...hooksPlugin.configs.recommended.rules,
			'react/display-name': 'off',
			'react/prop-types': 'off',
			'react/jsx-uses-react': 'off',
			'react/react-in-jsx-scope': 'off',
			'react-compiler/react-compiler': 'error',
		},
	},

	// Custom
	{
		ignores: [
			'dist',
			'**/*.d.ts',
			'**/.expo/**',
			'prettier.config.mjs',
			'eslint.config.js',
		],
	},
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/restrict-template-expressions': 'off',
		},
	},
]);
