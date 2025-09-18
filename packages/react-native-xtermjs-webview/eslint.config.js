import { config as epicConfig } from '@epic-web/config/eslint';
import eslint from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import react from '@eslint-react/eslint-plugin';
import * as tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import eslintReact from 'eslint-plugin-react';
import pluginReactCompiler from 'eslint-plugin-react-compiler';
import hooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default defineConfig([
	...epicConfig,

	// ts-eslint
	eslint.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

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
			'@typescript-eslint/consistent-type-imports': 'off', // we need this to avoid including xtermjs in the RN bundle
		},
	},
]);
