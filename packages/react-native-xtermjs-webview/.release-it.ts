import { type Config } from 'release-it';

export default {
	npm: {
		publish: true,
		publishArgs: ['--access', 'public'],
	},
	git: {
		requireCleanWorkingDir: true,
		tagName: '${npm.name}-v${version}',
		tagAnnotation: '${npm.name} v${version}',
		tagMatch: '${npm.name}-v*',
		commitMessage: 'chore(${npm.name}): release v${version}',
		push: true,
	},

	github: {
		release: true,
		releaseName: '${npm.name} v${version}',
	},

	plugins: {
		'@release-it/conventional-changelog': {
			preset: 'conventionalcommits',
			infile: 'CHANGELOG.md',
			gitRawCommitsOpts: { path: 'packages/react-native-xtermjs-webview' },
		},
	},

	hooks: {
		'before:init': ['turbo run lint:check'],
		'after:bump': 'turbo run build',
		'after:release': 'echo "Published ${npm.name} v${version} to npm"',
	},
} satisfies Config;
