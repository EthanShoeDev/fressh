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
		// Auto-generated uniffi-bindgen-react-native bindings + leftover bob
		// build output (the real entry is lib/module/api.js).
		'packages/react-native-uniffi-russh/lib/module/generated/**',
		'packages/react-native-uniffi-russh/lib/module/index.js',
	],
	// System binaries invoked by package scripts. Not npm packages.
	ignoreBinaries: ['adb', 'expo', 'gh', 'just', 'lsof', 'maestro', 'nix'],
	// Suppress exports/types that knip can't trace forward but are referenced
	// elsewhere in their own file (factory return types, registered components,
	// etc.). Cuts noise from in-file type aliases and tanstack-form-style HOC
	// registrations like `createFormHook({ fieldComponents: { TextField } })`.
	ignoreExportsUsedInFile: true,
};

export default config;
