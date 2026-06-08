# Future project: tighten the lint pipeline (enforce knip, burn down suppressions)

**Status:** PARTIALLY DONE — the foundations exist; this doc is about closing the gaps.
The two big pieces people assume are missing (oxlint React rules, knip) are **already in
the repo**. What's left is wiring, coverage, and a long-tail cleanup.

**Scope:** repo-root lint configuration only — `oxlint.config.ts`, `knip.ts`,
`turbo.jsonc`, the root `package.json` scripts, and `.github/workflows/check.yml`. No
application/runtime code, no per-package tooling.

## Where we already are (don't re-do this)

- **oxlint React rules are on.** `oxlint.config.ts` enables the `react`, `react-perf`, and
  `jsx-a11y` plugins, with the `correctness` / `perf` / `restriction` / `suspicious` /
  `pedantic` / `style` categories all set to `error`. There are ~40 React-specific rule
  tunings already in the `rules` block (e.g. `react/no-unstable-nested-components` with
  `allowAsProps`, `react/forbid-component-props` off for RN's universal `style`, the
  `react-perf/jsx-no-*-as-prop` family off). This was set up when we dropped `ultracite`
  and started owning the config directly. **Adding the React plugins is not work that
  remains** — the work that remains is deciding which currently-`off` React rules to turn
  back on (see "Burn down the suppression backlog").
- **knip is installed and configured.** `knip` is a devDependency, there's a `knip.ts`
  config with `ignoreDependencies` for the string-referenced deps (the `@fressh/oxlint-plugins`
  jsPlugins, `eslint`, `@effect/language-service`, `@effect/tsgo`), and
  `knip:check` / `knip:fix` scripts exist in the root `package.json`. **Installing/
  configuring knip is not the remaining work** — *enforcing* it is.

## The actual gaps

### 1. knip is configured but never runs in CI

This is the real meaning of "I want knip in this repo." Today:

- `turbo.jsonc` defines `//#knip:check` and `//#knip:fix`, but **both are empty `{}` and
  referenced by nothing.**
- The aggregate `lint:check` task is `with: ["tsgo:check", "//#oxfmt:check",
  "//#oxlint:check"]` — **no knip.**
- CI (`.github/workflows/check.yml`) runs `bunx turbo lint:check`. So nothing fails the
  build on unused dependencies, exports, or files.

**Target:** fold knip into the same root-aggregate pattern the other root checks already
use. Note `//#oxlint:check` already rides `jscpd:check` and `catalog:check` along via its
`with` list — knip should join the lint pipeline the same way:

- Add `//#knip:check` to the `lint:check` task's `with` list (the CI path).
- Add `//#knip:fix` to the `lint` (fix) task's `with` list, so a local `turbo lint`
  autofixes unused code alongside oxlint/oxfmt. This directly satisfies "make `knip:fix`
  part of the turbo lint pipeline."
- Give `//#knip:check` / `//#knip:fix` real `dependsOn` entries for anything that must be
  built/generated before knip can resolve imports (mirror how `//#oxlint:check` depends on
  `@fressh/oxlint-plugins#build`). Today they're empty; if knip needs generated files
  (codegen, route trees) to avoid false "unused" reports, declare those here.

Keep the `lint` / `lint:check` split intact: `lint` runs the `:fix` variants, `lint:check`
runs the read-only variants (what CI uses).

### 2. One root lint command should cover every package — and for knip it doesn't yet

The intent is a **single root-level lint that covers all workspaces**, not a separate lint
command per package. For oxlint this is already true: the root script runs
`oxlint -c oxlint.config.ts … .`, which walks the whole tree from the repo root (minus
`ignorePatterns`), so every package under `apps/*` and `packages/*` is linted by the one
root invocation. Good — leave it.

knip is the part that doesn't fully cover the monorepo yet. `knip.ts` has **no
`workspaces` block**, so knip falls back to auto-detecting workspaces from the
`package.json` `workspaces` field (`apps/*`, `packages/*`) with default entry-point
assumptions. That under-serves the packages with non-standard entry conventions and will
produce false positives/negatives:

- **`apps/mobile`** (Expo Router): entry is `expo-router/entry` → `src/app/**`, plus
  `metro.config.ts` and any `plugins/**` config plugins, none of which knip traces by
  default. Platform-extension files (`*.{web,ios,android,native}.{ts,tsx}`) are picked by
  the RN bundler by filename and look "unimported" to knip.
- **`packages/react-native-terminal`**: Nitro spec files (`*.nitro.ts`) are consumed by
  nitrogen codegen, not imported as JS — they need explicit `entry` patterns or knip will
  strip their exports as unused. Same for `react-native.config.js` / `babel.config.js`
  discovered by RN's autolinker.
- **`apps/web`** (Astro), **`packages/oxlint-plugins`**, **`packages/assets`**: confirm
  each has correct `entry`/`project` globs so a whole-repo `knip` run is trustworthy enough
  to gate CI on.

**Target:** add an explicit `workspaces` block to `knip.ts` with per-workspace `entry`,
`ignore`, and `ignoreDependencies` so the single root knip run genuinely and accurately
covers all packages. This is config in one root file — it does **not** mean per-package
lint scripts.

### 3. Burn down the suppression backlog

`oxlint.config.ts` carries a large set of rules turned `'off'` with honest "not the right
fight yet" comments. Two buckets worth re-enabling incrementally:

- **The unsafe-flow family**, all off with "existing code paths are not fully migrated":
  `typescript/no-unsafe-assignment`, `…/no-unsafe-member-access`, `…/no-unsafe-call`,
  `…/no-unsafe-return`. These are genuine correctness rules; the suppression is a migration
  debt, not a permanent decision. Turning them back on (per-package, via the existing
  `overrides` mechanism, so the blast radius is bounded) is a concrete, gradual project.
- **Rules disabled purely to preserve the pre-1.68 / tsgolint-0.23 baseline** (e.g.
  `require-unicode-regexp`, `prefer-named-capture-group`, `no-underscore-dangle`). These
  were switched off to avoid a big-bang diff on the version bump, not because we disagree
  with them. Re-evaluate case by case.

Leave the rules that are off for a *stated structural reason* (Effect-TS generators vs
`consistent-return`, oxfmt conflicts, RN/Hermes runtime constraints like
`unicorn/no-array-sort`, intentional bitwise ops for the SSH/terminal byte work) — those
are decisions, not debt. The discipline already encoded at the top of the `rules` block —
*every* deviation gets a comment explaining why — should hold for anything re-enabled or
newly suppressed here.

## Phasing

- **v0 (enforce what we have):** wire `//#knip:check` into `lint:check` and `//#knip:fix`
  into `lint`; give both real `dependsOn`. Fix whatever knip flags on first CI run (either
  delete genuinely-dead code or add a justified `ignore`/`ignoreDependencies` entry). End
  state: CI fails on unused deps/exports/files. Smallest, highest-value step.
- **v1 (trustworthy coverage):** add the `workspaces` block to `knip.ts` so every package
  is analyzed with correct entry points — especially `apps/mobile` (Expo Router) and
  `packages/react-native-terminal` (Nitro). Without this, v0's gate is noisy.
- **v2 (rule burn-down):** re-enable the unsafe-flow and baseline-preservation rules
  incrementally, scoped via `overrides` so each package can be cleaned independently.

## Risks & open questions

- **knip false positives on framework-magic entry points.** RN/Expo/Nitro/Astro all have
  files that are discovered by convention rather than imported. The first `knip:check` in
  CI will surface a batch of these; budget time to triage real-vs-noise and encode the
  noise as justified config rather than blanket-ignoring. A too-broad ignore silently
  defeats the point of adding the gate.
- **CI time / memory.** The lint job already fans out tsgo + oxlint + jscpd + catalog;
  knip adds a full dependency-graph pass. Confirm the runner has headroom (the oxlint pass
  already bumps `--max-old-space-size` for jscpd) before turning it on as required.
- **Rule burn-down is open-ended.** Don't gate this doc's "done" on zero suppressions —
  the unsafe-flow migration in particular could be large. Treat re-enabling as opportunistic
  per-package cleanup, not a blocking milestone.

## How this relates to the other future docs

This is pure repo-tooling — it touches the lint config, `turbo.jsonc`, and CI only, and
shares no surface with the terminal/SSH/renderer projects
([terminal-semantic-events.md](terminal-semantic-events.md),
[git-diff-integration.md](git-diff-integration.md),
[on-device-shell.md](on-device-shell.md)) or the app-shell UI work
([native-ui-theme-or-themes.md](native-ui-theme-or-themes.md)). It can ship independently
and at any time, and v0 alone is a small, self-contained PR.

## Bug: `cargo fmt` reformats the vendored alacritty fork

**Symptom.** Running `just fmt` (`cargo fmt --all`) in
`packages/react-native-terminal/rust` rewrites ~10 files inside
`vendor/alacritty` (e.g. `alacritty_renderer/src/lib.rs`, `selection.rs`,
`message_bar.rs`, both `build.rs`), producing hundreds of lines of pure
reformatting with zero logic change. `just fmt-check` then always reports the
submodule as dirty, so it can't be used as a gate.

**Cause.** Our `rust/rustfmt.toml` differs from alacritty's upstream style, and
even though the workspace `exclude`s `vendor/alacritty`, `cargo fmt` still
reaches the vendored crates through the `alacritty_renderer` path dependency
(pulled in by `fressh-render`) and reformats them with our config.

**Why it matters.** This silently diverges the fork from upstream alacritty for
no functional reason — exactly what the `minimize-alacritty-fork-divergence`
rule warns against — and makes future rebases onto a newer alacritty tag
conflict-heavy. It already caused a batch of accidental churn that had to be
reverted by hand.

**Fix options.**
- **Scope fmt to our crates (recommended, minimal).** Change the `fmt` /
  `fmt-check` recipes from `cargo fmt --all` to an explicit package list
  (`-p fressh-core -p fressh-ssh -p fressh-render -p shim-uniffi`) so the
  vendored crates are never touched and `fmt-check` becomes a usable gate again.
- **Match upstream's rustfmt config.** Vendor alacritty's own `rustfmt.toml`
  into the fork tree so our formatter produces upstream-identical output. More
  fragile — drifts whenever upstream changes its style.