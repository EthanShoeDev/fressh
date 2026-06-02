#!/usr/bin/env bun
/**
 * Post-generate fixups for files emitted by `uniffi-bindgen-react-native`
 * (`ubrn ... --and-generate`). ubrn overwrites these on every run, so this
 * script must run AFTER each generate (it's chained into the `ubrn:build:*`
 * package scripts). Every fix is idempotent — safe to run repeatedly.
 *
 * Fix #1 — android/CMakeLists.txt uniffi package resolve.
 *   ubrn emits `node -p "require.resolve('uniffi-bindgen-react-native/package.json')"`
 *   to locate its `cpp/includes` headers. That throws on ubrn >= 0.31, whose
 *   package.json `exports` map blocks the `./package.json` subpath
 *   (ERR_PACKAGE_PATH_NOT_EXPORTED) — leaving the include path empty, so the
 *   native build fails with `'UniffiCallInvoker.h' file not found`. We only need
 *   the on-disk package dir, so resolve it by walking up node_modules with
 *   existsSync (no module resolution, no exports involvement).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const pkgDir = dirname(import.meta.dir); // scripts/ -> package root
let fixed = 0;

// ---- Fix #1: CMakeLists.txt resolve ----------------------------------------
const cmakePath = join(pkgDir, 'android', 'CMakeLists.txt');
const WALK_UP_MARKER = 'while(d.length>1)';
const BROKEN_BLOCK =
	`# Resolve the path to the uniffi-bindgen-react-native package
execute_process(
    COMMAND node -p "require.resolve('uniffi-bindgen-react-native/package.json')"
    OUTPUT_VARIABLE UNIFFI_BINDGEN_PATH
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
# Get the directory; get_filename_component and cmake_path will normalize
# paths with Windows path separators.
get_filename_component(UNIFFI_BINDGEN_PATH "\${UNIFFI_BINDGEN_PATH}" DIRECTORY)`;
const PATCHED_BLOCK =
	`# Resolve the uniffi-bindgen-react-native package ROOT directory.
# PATCHED by scripts/patch-ubrn-generated.ts (re-run after every regenerate).
# We can't use \`require.resolve('uniffi-bindgen-react-native[/package.json]')\`:
# ubrn >= 0.31 ships an \`exports\` map that blocks the \`./package.json\` subpath
# (ERR_PACKAGE_PATH_NOT_EXPORTED), and the bare specifier resolves to a deep dist
# file rather than the root. We only need the on-disk \`cpp/includes\` dir, so walk
# up node_modules with existsSync (no module resolution / exports involvement).
execute_process(
    COMMAND node -e "const fs=require('fs'),path=require('path');let d=process.cwd();while(d.length>1){const c=path.join(d,'node_modules','uniffi-bindgen-react-native');if(fs.existsSync(path.join(c,'package.json'))){process.stdout.write(c);break;}d=path.dirname(d);}"
    OUTPUT_VARIABLE UNIFFI_BINDGEN_PATH
    OUTPUT_STRIP_TRAILING_WHITESPACE
)`;

if (existsSync(cmakePath)) {
	const src = await Bun.file(cmakePath).text();
	if (src.includes(WALK_UP_MARKER)) {
		console.log('[patch-ubrn-generated] CMakeLists.txt already patched.');
	} else if (src.includes(BROKEN_BLOCK)) {
		await Bun.write(cmakePath, src.replace(BROKEN_BLOCK, PATCHED_BLOCK));
		console.log('[patch-ubrn-generated] CMakeLists.txt resolve patched.');
		fixed++;
	} else {
		console.warn(
			'[patch-ubrn-generated] WARNING: CMakeLists.txt resolve block not recognized — ubrn template may have changed. Review the resolve manually.',
		);
	}
} else {
	console.warn(`[patch-ubrn-generated] ${cmakePath} not found; skipping.`);
}

console.log(`[patch-ubrn-generated] done (${fixed} file(s) changed).`);
