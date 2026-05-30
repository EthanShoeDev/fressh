import type { KnipConfig } from 'knip';

const config: KnipConfig = {
	ignore: [
		// Rust build outputs (cargo doc, target/, etc.) pulled into packages by uniffi.
		'**/rust/target/**',
		// Skill / agent assets that ship alongside the repo but aren't part of the app source.
		'.agents/**',
		'.claude/**',
		'app/**',
		// Local build artifacts that escape gitignore detection.
		'apps/mobile/build-*.apk',
		'apps/mobile/dist/**',
	],
};

export default config;
