import type { Config } from 'release-it';

export default {
	git: {
		requireCleanWorkingDir: true,
		tagName: '${npm.name}-v${version}',
		tagAnnotation: '${npm.name} v${version}',
		tagMatch: '${npm.name}-v*',
		commitMessage: 'chore(${npm.name}): release v${version}',
		push: true,
	},

	// This one *does* publish to npm
	npm: {
		publish: true,
		// pass flags you’d give to `npm publish`
		publishArgs: ['--access', 'public'],
		// (optional) skip npm’s own prepublish checks:
		// skipChecks: true
	},

	github: {
		release: true,
		releaseName: '${npm.name} v${version}',
		// optional: attach build artifacts
		// assets: ['dist/**']
	},

	plugins: {
		'@release-it/conventional-changelog': {
			preset: 'conventionalcommits',
			infile: 'CHANGELOG.md',
			gitRawCommitsOpts: { path: 'packages/react-native-uniffi-russh' },
		},
	},

	hooks: {
		'before:init': ['turbo run lint:check'],
		'before:npm:release': 'turbo run build:android build:ios',
		'after:release': 'echo "Published ${npm.name} v${version} to npm"',
	},
} satisfies Config;
