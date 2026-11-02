# AGENTS.md

This is the canonical instruction file for every coding agent working in this
repository. `CLAUDE.md` imports it; do not duplicate rules there.

## Workflow

- Work in focused, reviewable steps. Do not silently expand the current task
  into a broader refactor.
- Never use `git stash`, create branches, or commit without the user's
  permission.
- Before creating a pull request or declaring a code-changing task complete,
  run lint and typecheck on each affected package:

  ```sh
  bunx turbo lint:check typecheck --filter=<affected-package>
  ```

- Do not rerun lint and typecheck after every intermediate edit.
- Use `lint:check` for verification. `lint` runs fixers and may modify the
  working tree; run it only when intentionally applying fixes.
- Use `bun run test` to invoke Vitest. Do not use `bun test`, which runs
  Bun's built-in test runner instead. Vitest runs under node and cannot load
  React Native or Expo modules, so only pure-logic files get unit tests; UI
  flows are covered by maestro (`bun run --cwd apps/mobile maestro:test`).

## Bun

Bun is the only package manager. Use `bun install`, `bun run <script>`,
`bunx`, and `bun <file>`; never npm, yarn, pnpm, npx, or ts-node. Every
dependency version lives in the root `workspaces.catalog`; packages depend on
`catalog:` (`bun run catalog:check` enforces it). The published
`@fressh/react-native-terminal` lists its npm-facing ranges in `catalogSkip`.

## Code style

- Prefer concise, simple solutions. Propose a simpler approach when one exists.
- Prefer inferred TypeScript types. Do not add return types or annotations the
  compiler can infer.
- Comments only for a non-obvious *why*. Lint directives and the reason text a
  lint rule requires are the exception.
- Every `oxlint-disable` directive needs a description:
  `// oxlint-disable-next-line <rule> -- <reason>`.
- Zero warnings: rules are `error` or `off`, and every rule change in
  `oxlint.config.ts` carries a one-line reason above it.

## Effect

- Effect v4 everywhere. Write effectful functions with `Effect.fn`, model
  failures as tagged errors, and log with `Effect.log`, not `console`.
- Time comes from `Clock` (and `TestClock` in tests), never `Date.now()`.
- Shell out from TypeScript with `effect/unstable/process` `ChildProcess`, and
  log the command being run.

## Tooling

Lint, format, tsconfig and knip configs come from the published
[shoemaker](https://github.com/EthanShoeDev/shoemaker) packages
(`shoemaker-oxlint-config`, `shoemaker-oxfmt-config`,
`shoemaker-typescript-config`, `shoemaker-knip-config`). Repo-specific rules go
in the root config files on top of them; preference changes arrive by bumping
`shoemaker-*`. `bun run catalog:check`, `effect-versions:check` and
`nix:fmt:check` run the `shoemaker` CLI's checks.

## Project notes

- `@fressh/react-native-terminal` ships source plus codegen output (nitrogen +
  ubrn bindings). Let turbo sequence its native builds: `typecheck` and
  `oxlint` depend on its `codegen`, and `turbo run android` adds the
  cargo-ndk `.so` build. Run native builds inside the nix dev shell.
- Expo-SDK-locked dependencies (`expo*`, `react`, `react-native`,
  `react-native-*` native modules) follow the installed SDK's
  `bundledNativeModules.json`; set them with `bun run --cwd apps/mobile
  expo:install:fix`, not by hand.

## Patched dependencies

Every `bun patch` entry in `patchedDependencies` is documented in
`docs/bun-patches.md`: why it exists and its upstream issue. Whenever you add,
update, or remove a patch, update that doc in the same change. Patches are
keyed to exact versions, so bumping a patched dependency means re-validating
its patch.
