import { type Config } from 'release-it';

export default {
	git: {
		requireCleanWorkingDir: true,
		commitMessage: 'chore(release): v${version}',
		tagName: 'v${version}',
		push: true,
	},
	github: {
		release: true,
		assets: ['android/app/build/outputs/apk/release/app-release.apk'],
	},
	plugins: {
		'release-it-pnpm': {},
		'@release-it/conventional-changelog': {
			preset: 'conventionalcommits',
			infile: 'CHANGELOG.md',
		},
	},
	hooks: {
		'before:init': ['pnpm run lint:check', 'pnpm run typecheck'],
		'before:github:release': 'pnpm run build:signed:apk',
	},
} satisfies Config;
