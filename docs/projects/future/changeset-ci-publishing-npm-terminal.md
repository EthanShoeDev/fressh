# Future project: changeset-driven npm publishing for `@fressh/react-native-terminal`

**Status: NOT STARTED — planning doc.** Describes what we want, what we used to
have, and the gaps to close. No implementation yet. The plumbing this needs
(changesets, the two-mode `release.yml`) already exists for `@fressh/mobile`;
this is about extending it to publish a *public* npm package again.

**Scope:** `packages/react-native-terminal/package.json`, its `README.md`, the
root `README.md` (badge), `.changeset/config.json`, and `.github/workflows/release.yml`.
No native/runtime code changes.

## The goal

1. Publish `@fressh/react-native-terminal` to the public npm registry, versioned
   and changelogged via **changesets** (same lever as `@fressh/mobile`), with a
   **"Version Packages" PR → merge → tag + publish** flow.
2. Publish via **npm OIDC trusted publishing** (provenance, no long-lived
   `NPM_TOKEN` secret) — this is the part we specifically want to keep from the
   old setup's intent.
3. **Clean up `packages/react-native-terminal/README.md`** so it reads as
   published-package docs (install + usage), not just an internal scaffold note.
4. Add an **npm version badge** for the package to the root `README.md`.

## Background — what used to happen

Before the native-renderer rewrite, the terminal lived in two separately
published packages, both deleted in `b754310` ("migrate to
`@fressh/react-native-terminal`; delete old uniffi-russh + xtermjs-webview"):

| Package                                  | Last published | Role                         |
| ---------------------------------------- | -------------- | ---------------------------- |
| `@fressh/react-native-uniffi-russh`      | `v0.0.5`       | uniffi bindings for russh    |
| `@fressh/react-native-xtermjs-webview`   | `v0.0.8`       | xterm.js WebView terminal    |

Both published through **`release-it`** (later dropped repo-wide in `ec6f228`,
"changesets + secretspec foundation; drop release-it"). Each package had a
`.release-it.ts` like:

```typescript
// packages/react-native-uniffi-russh/.release-it.ts (historical)
export default {
  npm: { publish: true, publishArgs: ['--access', 'public'] },
  git: {
    requireCleanWorkingDir: true,
    tagName: '${npm.name}-v${version}',
    commitMessage: 'chore(${npm.name}): release v${version}',
    push: true,
  },
  github: { release: true, releaseName: '${npm.name} v${version}' },
  plugins: {
    '@release-it/conventional-changelog': {
      preset: 'conventionalcommits',
      infile: 'CHANGELOG.md',
      gitRawCommitsOpts: { path: 'packages/react-native-uniffi-russh' },
    },
  },
  hooks: {
    'before:init': ['turbo run lint:check'],
    'after:bump': ['turbo run build:android build:ios'],
  },
} satisfies Config;
```

Invoked **locally** (`GITHUB_TOKEN=$(gh auth token) release-it`), per-package
tags (`<name>-v<version>`), conventional-changelog `CHANGELOG.md`, and a GitHub
Release per publish. npm auth was a token, not OIDC.

> **Honest note on "the npm OIDC thing":** the historical release-it config
> published with a token, not OIDC trusted publishing. OIDC is what we *want*
> for the new package (see below) — treat it as the target, not a literal
> restoration. If a token-published era did exist, we're upgrading off it.

## What exists now (don't rebuild this)

- **changesets is already wired.** Root devDeps have `@changesets/cli` +
  `@changesets/changelog-github`; `.changeset/config.json` is present; the
  two-mode `release.yml` ("Version Packages" PR ↔ tag/release) runs on every
  push to `main`.
- **But it only *tags*, never *publishes*.** `release.yml` calls the changesets
  action with `publish: bun run tag` (i.e. `changeset tag`) — deliberately,
  because `@fressh/mobile` is `private` and never goes to npm. There is no
  `npm publish` step anywhere.
- **`.changeset/config.json` is `"access": "restricted"`** and
  `privatePackages: { version: true, tag: true }` — tuned for the private app,
  not for a public package.
- **The terminal package is `private: true`, version `0.0.0`.** It currently
  exports **TypeScript source** (`main`/`types`/`exports` all → `./src/index.ts`),
  with a broad `files` whitelist (`lib`, `android`, `ios`, `cpp`, `nitro`, `src`,
  `rust`, `*.podspec`, `*.xcframework/**`, …). It is consumed in-source by the
  monorepo today, so nothing forces a build artifact to exist.

## The hard part — what does a published tarball actually contain?

This is the real design decision, and the reason this is its own project. The
old packages were comparatively light; the new one carries a **Rust + cargo-ndk
+ ubrn + nitrogen** pipeline. Options:

1. **Ship source, build on the consumer's machine.** Smallest tarball, but every
   installer needs the full Rust toolchain + NDK + ubrn + nitrogen. Almost
   certainly a non-starter for an npm dependency.
2. **Pre-build native artifacts and ship them in the tarball** — `.so` per
   Android ABI, the iOS `.xcframework` (~114MB), generated TS/C++ bindings. Big
   tarball, but `bun add @fressh/react-native-terminal` "just works" via
   autolinking. This is the RN-native-module norm.
3. **Hybrid** — ship prebuilt artifacts as the default, leave a source build
   path for contributors.

Whichever we pick drives: the `files` whitelist (are `rust/`/`src/` source dirs
shipped or stripped?), whether codegen/`build:android`/`build:ios` run in a
`prepack`/CI step before publish, and how large the published tarball is. **The
package emits no build artifacts today (source-only `exports`)**, so option 2/3
also means deciding the compiled entry points (`lib/module/...` like the old
uniffi-russh package used) and pointing `exports` at them for published consumers
while keeping source resolution for the workspace.

> Decide this first — the publish workflow can't be finalized until we know what
> gets packed and what (if anything) has to build before `npm publish`.

## Publishing mechanism — npm OIDC trusted publishing

Target design (no `NPM_TOKEN`):

- Configure the package on npmjs.com as a **trusted publisher** bound to this
  repo's `release.yml` workflow.
- Grant the publish job **`id-token: write`** (the repo already uses
  `id-token: write` for Google WIF in the mobile build job, so the pattern is
  familiar) and publish with **`--provenance`** so npm records a provenance
  attestation.
- Bump `@changesets/cli` if needed and confirm the version in CI emits OIDC
  provenance on publish (recent npm CLI required).

### Wiring into the existing two-mode `release.yml`

The changesets action's `publish:` input currently runs `bun run tag`. To also
publish npm packages we either:

- switch the publish command to a script that runs `changeset publish` (which
  publishes any non-private, newly-versioned package **and** tags), keeping
  `changeset tag` behavior for the still-private `@fressh/mobile`; or
- add a dedicated publish step after the changesets action when
  `outputs.published == 'true'` and the published set includes the terminal
  package.

Either way the job needs `id-token: write` added to its `permissions:` (today
that block is only `contents: write` + `pull-requests: write`; `id-token` is
currently granted only to the downstream `build-mobile` job). `--provenance`
also wants the build to run in that same job so the artifacts are attested.

### `.changeset/config.json` changes

- The terminal package must become **non-private** (`private: true` removed) for
  changesets to publish it.
- Reconcile `"access"`: it's `"restricted"` globally today; the terminal package
  must publish as **public**. Set the package's `publishConfig.access: "public"`
  (per-package override) rather than flipping the global default, so the private
  app's posture is untouched.
- Keep `privatePackages: { version: true, tag: true }` for `@fressh/mobile`.

## README cleanup (`packages/react-native-terminal/README.md`)

Today it opens with a `> **Status: scaffold + renderer extraction proven.**`
note and leans on `docs/projects/native-rendering-refactor.md` (§N references) —
internal-facing. For a published package, restructure toward consumer docs:

- **Install** (`bun add @fressh/react-native-terminal`, peer deps:
  `react`, `react-native`, `react-native-nitro-modules`; Expo config-plugin /
  autolinking notes; min RN version).
- **Usage** — the public `src/index.ts` surface (`Terminal` view + ssh control
  plane), a minimal connect-and-render snippet.
- **Platform support / requirements** — Android + iOS (ANGLE→Metal) status, any
  New-Architecture / Nitro requirement.
- Keep the architecture/four-planes section, but move the scaffold-status
  blockquote and the "deviation from the doc" review note **below the fold** or
  into the design doc — they shouldn't be the first thing a prospective user
  reads.
- Drop or soften the `§N` cross-refs that only make sense with the design doc
  open.

## Root README badge

The root `README.md` puts badges right under the title (line 8):

```markdown
[![ci](https://github.com/EthanShoeDev/fressh/actions/workflows/check.yml/badge.svg)](https://github.com/EthanShoeDev/fressh/actions/workflows/check.yml)
```

Add an npm version badge next to it, e.g.:

```markdown
[![npm](https://img.shields.io/npm/v/@fressh/react-native-terminal)](https://www.npmjs.com/package/@fressh/react-native-terminal)
```

The architecture section already names the package; once it's on npm, link the
name to the npm page there too. Consider also a provenance/downloads badge.

## Implementation checklist (when we pick this up)

1. **Decide the tarball contents** (source-only vs. prebuilt vs. hybrid) — gates
   everything else.
2. Un-`private` the package; set `publishConfig.access: "public"`; pick the real
   first version (changeset, not `0.0.0`).
3. Point `exports`/`main`/`types` at published entry points if we ship compiled
   output; tighten the `files` whitelist accordingly.
4. Add the `prepack`/CI build step so codegen + native artifacts exist before
   publish (if option 2/3).
5. Register the package as an npm **trusted publisher** for `release.yml`.
6. Extend `release.yml`: `changeset publish` (or a guarded publish step),
   `id-token: write`, `--provenance`.
7. Verify a dry-run publish (`npm publish --dry-run`, inspect `npm pack`
   contents and size).
8. Clean up the package README; add the root README npm badge + npm link.

## Open questions

- Tarball size if we ship the iOS `.xcframework` (~114MB) — acceptable, or split
  iOS artifacts behind a fetch step / separate distribution?
- Do we publish on **every** Version Packages merge, or gate the terminal
  package's first publish until the API is stable?
- Does the published package need an **Expo config plugin** for autolinking, and
  should that ship in the same package?
- Provenance requires the build to happen in the publishing job — does the full
  native build fit in that job's time/runner budget, or do we publish prebuilt
  artifacts produced by an earlier job?

## References

- `docs/projects/complete/ci-building-and-releasing.md` — the changesets +
  two-mode `release.yml` design this extends.
- `.github/workflows/release.yml` — current two-mode (tag-only) release flow.
- `.changeset/config.json` — current changesets config.
- Deleted historical configs (recover via `git show b754310^:<path>`):
  `packages/react-native-uniffi-russh/.release-it.ts`,
  `packages/react-native-xtermjs-webview/.release-it.ts`.
- npm docs: trusted publishing (OIDC) + publish provenance.
</content>
</invoke>
