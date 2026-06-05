# Turbo Tasks and Package.json Scripts

This document describes the conventions and rules for turbo tasks and npm scripts in this monorepo.

## Script Naming Convention

All scripts follow the pattern `<tool>:<action>` where:
- `<tool>` is the name of the CLI tool being invoked (e.g., `oxlint`, `oxfmt`, `tsgo`, `vite`)
- `<action>` is what the tool is doing (e.g., `fix`, `check`, `build`, `dev`)

Examples:
- `oxlint:fix` - Run oxlint with auto-fix
- `oxlint:check` - Run oxlint without auto-fix (check only)
- `tsgo:check` - Run TypeScript type checking with tsgo
- `vite:build` - Build with Vite

Generic aliases like `build`, `dev`, and `test` are allowed as shortcuts:
```json
{
  "build": "bun run vite:build",
  "dev": "bun run vite:dev"
}
```

## Oxlint Monorepo Configuration

Due to [oxc-project/oxc#12492](https://github.com/oxc-project/oxc/issues/12492), oxlint's type-aware linting currently only supports a single `tsconfig.json`. In our monorepo, each workspace has different TypeScript configurations:

- `apps/mobile` uses Expo's tsconfig (`expo/tsconfig.base`) which provides proper types for `process.env.EXPO_PUBLIC_*` variables
- `apps/web` uses Astro's TypeScript configuration
- `packages/*` have their own tsconfig files with different settings

Because of this limitation, **each workspace must have its own `oxlint:fix` and `oxlint:check` scripts** that run oxlint with that workspace's `.oxlintrc.json` config:

```json
{
  "oxlint:fix": "oxlint -c .oxlintrc.json --type-aware --type-check --report-unused-disable-directives-severity=error --fix .",
  "oxlint:check": "oxlint -c .oxlintrc.json --type-aware --type-check --report-unused-disable-directives-severity=error ."
}
```

Each workspace's `.oxlintrc.json` extends the root config:
```json
{
  "$schema": "../../node_modules/oxlint/configuration_schema.json",
  "extends": ["../../.oxlintrc.json"]
}
```

### Required Oxlint Flags

All oxlint scripts **must** include these flags:
- `--type-aware` - Enable type-aware linting rules
- `--type-check` - Enable TypeScript type checking
- `--report-unused-disable-directives-severity=error` - Forbid unused lint ignore comments (prevents stale disable directives)

## Oxfmt (Formatting)

Unlike oxlint, **oxfmt only runs at the root level**. The root `oxfmt:fix` and `oxfmt:check` scripts format all files in the entire monorepo:

```json
{
  "oxfmt:fix": "oxfmt --write",
  "oxfmt:check": "oxfmt --check"
}
```

Workspace packages do **not** have their own oxfmt scripts. This ensures consistent formatting across the entire codebase.

## Turbo Task Configuration

### Root turbo.jsonc

The root `turbo.jsonc` defines base task definitions that all packages inherit:

```jsonc
{
  "tasks": {
    // Workspace tasks (run per-package)
    "oxlint:fix": {
      "dependsOn": ["^build"],
      "with": ["tsgo:check"]
    },
    "oxlint:check": {
      "dependsOn": ["^build"],
      "with": ["tsgo:check"]
    },
    "tsgo:check": {
      "dependsOn": ["^build"]
    },
    "build": {
      "outputs": ["dist/**"],
      "dependsOn": ["^build"]
    },

    // Root-only tasks
    "//#oxfmt:fix": { "with": ["nix:fmt"] },
    "//#oxfmt:check": { "with": ["nix:fmt:check"] },
    "//#oxlint:fix": {
      "dependsOn": ["@fressh/oxlint-plugins#build"],
      "with": ["jscpd:check", "catalog:fix"]
    }
  }
}
```

### Task Dependencies

- `^build` - Run `build` in all dependency packages first (topological order)
- `with: [...]` - Run these tasks in parallel for the same package
- `//#taskName` - Root-only task (runs once, not per-package)

### Why oxlint depends on ^build

Type-aware linting needs TypeScript declaration files from dependencies. The `^build` dependency ensures that all dependency packages are built first, making their `.d.ts` files available for type checking.

## Build and Dev Tasks

### Build Task

The `build` task compiles source code for each package:

```jsonc
{
  "build": {
    "outputs": ["dist/**"],
    "dependsOn": ["^build"]
  }
}
```

Each package has a `build` script that aliases its specific build tool:
- `packages/react-native-xtermjs-webview`: `"build": "bun run vite:build"`
- `packages/react-native-uniffi-russh`: `"build": "bun run bob:build"`
- `packages/oxlint-plugins`: `"build": "bun run tsdown:build"`
- `apps/web`: `"build": "bun run astro:build"`

### Dev Task

The `dev` task runs development servers:

```jsonc
{
  "dev": {
    "cache": false,
    "persistent": true,
    "dependsOn": ["^build"]
  }
}
```

### Mobile Dev (Android/iOS)

The mobile app has separate dev tasks for Android and iOS:

```jsonc
{
  "dev:android": {
    "dependsOn": ["^build", "^ubrn:build:android"],
    "cache": false,
    "persistent": true
  },
  "dev:ios": {
    "dependsOn": ["^build", "^ubrn:build:ios"],
    "cache": false,
    "persistent": true
  }
}
```

The `EXPO_PLATFORM` environment variable controls which platform to run:
```bash
# Run Android
EXPO_PLATFORM=android turbo dev --filter=@fressh/mobile

# Run iOS
EXPO_PLATFORM=ios turbo dev --filter=@fressh/mobile
```

The native builds (`ubrn:build:android`, `ubrn:build:ios`) are run as dependencies to ensure the Rust native modules are compiled before starting the dev server.

## Workspace-Specific Overrides

Packages can override the base task definitions in their own `turbo.jsonc`:

```jsonc
// apps/mobile/turbo.jsonc
{
  "extends": ["//"],
  "tasks": {
    "oxlint:fix": {
      "dependsOn": ["^build"],
      "with": ["tsgo:check", "expo:doctor"]
    }
  }
}
```

This adds `expo:doctor` to the mobile lint task to also check Expo compatibility.

## Running Tasks

```bash
# Format entire codebase
turbo //#oxfmt:fix

# Lint all packages (with fixes)
turbo oxlint:fix

# Lint all packages (check only)
turbo oxlint:check

# Build all packages
turbo build

# Run all linting (formatting + linting)
turbo //#oxfmt:fix && turbo oxlint:fix

# Check all linting (no fixes)
turbo //#oxfmt:check && turbo oxlint:check
```
