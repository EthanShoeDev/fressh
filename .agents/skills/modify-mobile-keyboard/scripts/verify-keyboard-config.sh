#!/usr/bin/env bash
set -euo pipefail

repo_root="${FRESSH_REPO:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

pnpm --dir apps/mobile validate:shell-config
pnpm --dir apps/mobile exec tsx --test \
	test/integration/shell-config-schema.test.ts \
	test/integration/keyboard-config.test.ts \
	test/integration/keyboard-routing.test.ts \
	test/integration/keyboard-runtime.test.ts \
	test/integration/command-presets.test.ts
