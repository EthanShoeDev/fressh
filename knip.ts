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
	// System binaries invoked by package scripts. Not npm packages.
	ignoreBinaries: ['adb', 'expo', 'gh', 'just', 'lsof', 'maestro', 'nix'],
};

export default config;
