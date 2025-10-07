import { type Config } from 'release-it';

export default {
	npm: { publish: false, ignoreVersion: true },

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
		assets: [
			'android/app/build/outputs/apk/release/app-release.apk',
			// or the AAB, if that’s your primary store artifact:
			// 'android/app/build/outputs/bundle/release/app-release.aab'
		],
	},

	plugins: {
		'@release-it/conventional-changelog': {
			preset: 'conventionalcommits',
			infile: 'CHANGELOG.md',
			gitRawCommitsOpts: { path: 'apps/mobile' },
		},
	},

	hooks: {
		'before:init': ['pnpm run lint:check', 'pnpm run typecheck'],
		'before:github:release': 'pnpm run build:signed:apk',

		'after:release': 'echo "Released ${npm.name} v${version}"',
	},
} satisfies Config;
