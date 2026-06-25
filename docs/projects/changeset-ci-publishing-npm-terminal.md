# Project: changeset npm publishing + canary/prerelease for `@fressh/react-native-terminal` (and app canaries)

**Status: IN PROGRESS — code implemented + statically verified (JSON/YAML/tsgo/oxfmt/`npm pack`); pending the manual `0.1.0` npm bootstrap, the npmjs.com trusted-publisher registration, and a real CI run to validate end-to-end (as of 2026-06-25).**

Re-enable public npm publishing of `@fressh/react-native-terminal` via **changesets +
npm OIDC trusted publishing** (provenance, no long-lived token), and add **canary
(snapshot)** and **prerelease (rc)** release lines for *both* the public package and the
private `@fressh/mobile` app. The stable changesets two-mode `release.yml` already exists
for the app; this extends it without breaking it.

**Scope:** `packages/react-native-terminal/package.json` + `README.md`, root `README.md`
(badge), `.changeset/config.json`, root `package.json` scripts, `.github/workflows/`
(new `release-npm.yml`, `canary-app.yml`; canary folded into `release.yml`; edits to `release.yml` +
`build-mobile.yml`), and the app build-number plumbing (`apps/mobile/app.config.ts`,
`changelog-extract.ts`, `fastlane/Fastfile`). No terminal native/runtime code changes
(one optional Rust `[profile.release]` size tweak is called out as a follow-up).

---

## Handoff — resume here (on your Mac)

The code is **complete and statically verified** (JSON, workflow YAML, `tsgo` 0 errors,
`oxfmt`, `npm pack`). What's left can only be done by you — mostly from a **Mac** (the iOS
xcframework is macOS-only) and on **npmjs.com**. This section is the authoritative
current-state + next-steps; the design sections below are rationale. Do the steps in order.

**Context that shapes the steps (verified 2026-06-25):** the `@fressh` **org already exists**
on npm (your old `@fressh/react-native-uniffi-russh` / `-xtermjs-webview` are published there
under `ethanshoedev`); `@fressh/react-native-terminal` is unregistered (free); a plain org
member can create packages (no role change). npm still **cannot** publish a brand-new name
via OIDC and you **cannot** pre-register a trusted publisher (npm/cli #8544, open) — so the
first publish is a manual bootstrap, then CI/OIDC forever after.

### 0 · Pre-checks

- [x] **Repo is PUBLIC** (verified 2026-06-25 via `gh repo view` → `"visibility":"PUBLIC"`),
  so `--provenance` is good to go.
- [ ] **Org access:** `npm org ls fressh` lists you; `npm access list packages @fressh` shows
  the old packages. (Confirm once logged in — see step 2.)

### 1 · Build the complete tarball (Mac, in `nix develop`) — ✅ DONE 2026-06-25

Only the Mac yields the iOS xcframework **and** the Android `.so`:

```sh
bunx turbo build build:android build:ios --filter @fressh/react-native-terminal
cd packages/react-native-terminal
npm pack --dry-run   # MUST list shim_uniffi.xcframework/… , android/src/main/jniLibs/… , {src,cpp,nitrogen}/generated/…
```

If `shim_uniffi.xcframework/` is absent, the iOS build didn't run — fix before publishing (a
tarball without it fails to link on iOS).

**Result (2026-06-25):** 5/5 turbo tasks succeeded. `npm pack --dry-run` lists the full set —
`shim_uniffi.xcframework/{ios-arm64 (40.2MB), ios-arm64_x86_64-simulator (80.0MB)}`,
`android/src/main/jniLibs/{arm64-v8a,x86_64}/libshim_uniffi.so` (~6.5MB each), and
`{src,cpp,nitrogen}/generated/`. **Tarball: 50.1 MB / 153.9 MB unpacked / 73 files / `0.1.0`.**
(The handoff's "11.3 MB" was a partial static check without the iOS xcframework; 50 MB is the
true full-build size. The optional Rust `[profile.release]` shrink in Follow-ups ≈ halves it.)

### 2 · Bootstrap-publish `0.1.0` by hand

Classic automation tokens were revoked (2025-12-09); use the web login (short-lived ~2h
session, nothing left on disk). From `packages/react-native-terminal`, with step 1 on disk:

```sh
npm login            # web flow; satisfy 2FA in the browser
npm whoami           # → ethanshoedev
npm publish --access public        # NO --provenance (provenance needs CI/OIDC)
```

`--access public` is required (scoped packages default to restricted; it's also in
`publishConfig`). Confirm: `npm access get status @fressh/react-native-terminal` → `public`.

### 3 · Register the trusted publisher on npmjs.com

⚠️ **CORRECTION (verified 2026-06-25 against live npm docs): npm allows only ONE trusted
publisher per package**, not two. ("Each package can only have one trusted publisher
configured at a time." — https://docs.npmjs.com/trusted-publishers/.) The earlier "register
two callers" plan is impossible. **Register `release.yml` only** — it covers stable (`latest`
on `main`) **and** rc (the `prerelease` branch), i.e. the real release line.

At `https://www.npmjs.com/package/@fressh/react-native-terminal/access` → **Trusted
Publisher** → **GitHub Actions**, add the single entry:

| Field                | Value         |
| -------------------- | ------------- |
| Organization or user | `EthanShoeDev`|
| Repository           | `fressh`      |
| Workflow filename    | `release.yml` |
| Environment name     | *(blank)*     |
| Allowed actions      | `npm publish` |

Register the **CALLER** (`release.yml`), not the reusable `release-npm.yml` — npm matches the
OIDC token's top-level entry-point workflow, not the reusable that runs `npm publish`
(npm/documentation #1755). `id-token: write` is granted in both, as required.

**Single-caller consolidation (DONE 2026-06-25).** Because npm allows one trusted publisher
per package and matches the top-level caller, **all three npm lines now originate from
`release.yml`**: stable (`main`), rc (`prerelease`), and canary (manual dispatch / push to
`canary` via the new `publish-terminal-canary` job → snapshot + `canary` dist-tag). The old
`canary-npm.yml` was **deleted** (it was a second caller npm couldn't accept). So you register
exactly one trusted publisher — `release.yml` — and every line works. (`canary-app.yml` stays:
it's app-only, never npm, so it's irrelevant to the trusted-publisher form.)

### 4 · First CI (provenance) release

```sh
bun run changeset    # changeset for the terminal pkg (+ app if changed); merge to main
# → "Version Packages" PR opens; merge it →
#   release.yml: tags + the publish-terminal job builds (Android+iOS) + `npm publish --provenance`
#   to `latest`; the app builds + submits to test channels.
```

Confirm `0.1.1` shows the provenance ✓ on npm. Fully tokenless from here.

### 5 · Test a canary

npm canary: **Actions → "Version & Release" → Run workflow** (or `git push origin HEAD:canary`)
— the `publish-terminal-canary` job snapshots + publishes to the `canary` dist-tag. Needs a
**pending changeset** (snapshot only versions changed packages). App canary is separate:
**Actions → "Canary app"** (store-derived build number, already wired). →
`bun add @fressh/react-native-terminal@canary`.

### 6 · (Optional) rc line

```sh
git checkout -b prerelease && bun run pre:enter   # commits .changeset/pre.json ON THIS BRANCH ONLY
git push -u origin prerelease
# release.yml (on prerelease) → x.y.z-rc.N on the `rc` dist-tag + app rc to internal.
# graduate: bun run pre:exit → version strips the suffix + deletes pre.json → merge to main.
```

🚫 Never let `.changeset/pre.json` reach `main`.

### Follow-ups (optional)

- **Rust size shrink:** add `[profile.release]` to `rust/Cargo.toml` (`strip`, `opt-level="z"`,
  `lto`, `codegen-units=1`; test FFI before `panic="abort"`) — ~50% off the iOS xcframework.
- **Verify on first CI run** (can't test from a laptop): the iOS-artifact upload/download path
  in `release-npm.yml`; reusable-workflow OIDC matching (#1755); the npm-≥11.5.1 upgrade step
  engaging OIDC (watch the `NODE_AUTH_TOKEN` shadowing gotcha).

---

## Decisions locked (2026-06-25)

- **History reconciled (verified via `git show b754310^`).** The two old packages
  (`@fressh/react-native-uniffi-russh` v0.0.5, `@fressh/react-native-xtermjs-webview`
  v0.0.8) published via **`release-it` run locally** (`GITHUB_TOKEN=$(gh auth token)
  release-it`, `npm.publish: true`, `--access public`). npm auth was a **long-lived local
  token**; `GITHUB_TOKEN` only cut the GitHub Release. That was **not** OIDC. OIDC is a
  genuine **upgrade**, not a restoration — and it's this project's whole point.

- **First version: `0.1.0`, experimental.** Not `0.0.0`. "Experimental" means an early/
  unstable *API*, **not** broken functionality — **iOS and Android both render and work**
  (iOS via ANGLE → Metal). The stale "scaffold/stub/Android-first" language has been
  corrected in the package README and the design doc.

- **Tarball = hybrid with INLINE prebuilt binaries.** Source-only is a non-starter
  (consumers would need the whole Rust + cargo-ndk + ubrn + nitrogen toolchain). Ship the
  prebuilt Android `jniLibs` (~9–13M), the iOS `shim_uniffi.xcframework`, the vendored
  ANGLE xcframeworks (~19M, already committed), the generated bindings, and the thin native
  glue **inside the main package** (our `files[]` already does this). Keep `rust/` + `src/`
  for the contributor build path. Revisit splitting into per-platform packages (the Skia
  model) only if release cadence makes the coupling annoying.

- **iOS size is fine.** The "~114MB" figure was the **debug** xcframework; `build-ios.sh`
  already builds `--release`. We currently define **no** `[profile.release]`; adding
  `strip` (and optionally `opt-level="z"`, `lto`, `codegen-units=1`) lands the 3-slice
  xcframework at **~35–55MB**, and the real *app-size* delta after Xcode `-dead_strip` is
  single-digit MB/arch. The Rust size tweak is an **optional follow-up** (test FFI before
  `panic="abort"`); inline is publishable today regardless.

- **No Expo config plugin** (Skia ships none and works in Expo via autolinking). Config
  plugins run **only** during `expo prebuild` — they do nothing for pure bare-RN apps,
  which autolink via `react-native.config.js` + podspec/gradle. Document correct usage +
  the two build floors in the README instead. The only thing a plugin would add is
  asserting **Android `minSdkVersion ≥ 26`** and **iOS `deploymentTarget ≥ 16.4`**.

- **`apps/mobile` fix (latent gap):** it sets Android `minSdk 26` via `expo-build-properties`
  but **never sets `ios.deploymentTarget`** — the 16.4 floor our Rust objects need is
  currently unenforced (works only by luck of the Podfile platform). Add
  `ios: { deploymentTarget: "16.4" }` to its `expo-build-properties` entry.

- **Publish auth = npm OIDC trusted publishing + provenance.** No `NPM_TOKEN`. Switch the
  changesets lever from `changeset tag` → `changeset publish`; add `id-token: write`;
  install **npm ≥ 11.5.1** (dev-shell npm is 10.9.3). **`bun publish` cannot emit
  provenance** → the publish step calls `npm publish --provenance` directly (the one
  sanctioned npm-over-bun exception, per CLAUDE.md).

- **Bootstrap = one manual publish, then OIDC.** npm OIDC cannot publish the *first*
  version of a never-published name, **and** a package with no normal release publishes to
  `latest` regardless of `--tag` — so the first canary would leak onto `latest`. Therefore
  the manual stable `0.1.0` bootstrap publish **must precede any canary**. After that, all
  releases are tokenless via CI.

- **Canary + prerelease, for the package and the app** (full design below).

---

## What exists now (don't rebuild)

- **changesets is wired**: root devDeps `@changesets/cli@2.31.0` + `@changesets/changelog-github`;
  `.changeset/config.json` present; two-mode `release.yml` (Version-Packages-PR ↔ tag) runs
  on push to `main`.
- **But it only *tags*, never *publishes*.** `release.yml`'s changesets action uses
  `publish: bun run tag` (= `changeset tag`) — git tags + GitHub Release only — deliberately,
  because `@fressh/mobile` is `private`. No `npm publish` anywhere.
- **`.changeset/config.json` is `access: "restricted"`** with `privatePackages:
  { version: true, tag: true }` — tuned for the private app.
- **The terminal package is `private: true`, `0.0.0`**, exports TS source
  (`main`/`types`/`exports` → `./src/index.ts`), consumed in-source by `apps/mobile` via
  `workspace:*`. Codegen + native artifacts are **all gitignored** and produced by `turbo`,
  not by any `package.json` lifecycle script → a naive publish from a clean checkout ships a
  **broken tarball**.
- **App build/submit pipeline**: `build-mobile.yml` (reusable; android on ubuntu, ios on
  macos-26; submit to Play internal / TestFlight via WIF + ASC key); `ship-prod.yml`
  (manual promote to production). `release.yml`'s `build` job calls `build-mobile.yml` when a
  mobile tag is cut.

---

## Publish mechanism — npm OIDC trusted publishing

- **npm CLI ≥ 11.5.1** + **`id-token: write`** on the publishing job. Provenance is then
  **automatic** (no `--provenance` flag strictly required, but we pass it / set
  `NPM_CONFIG_PROVENANCE=true` to be explicit). `changeset publish` inherits OIDC from npm
  (no changesets-specific flag); `@changesets/cli@2.31.0` is new enough.
- **Trusted-publisher binding on npmjs.com** is keyed to **repo + workflow filename**, and
  for a reusable workflow npm matches the **top-level CALLER** (`workflow_ref`), not the
  reusable file. **npm allows only ONE trusted publisher per package** (verified 2026-06-25 —
  https://docs.npmjs.com/trusted-publishers/), so the original "register `release.yml` AND
  `canary-npm.yml`" plan was impossible. **Resolved by consolidation:** the publish job lives
  in reusable `release-npm.yml`, and **`release.yml` is now its ONLY caller** — stable on
  `main`, rc on `prerelease`, and canary via its `publish-terminal-canary` job (dispatch /
  push `canary`). `canary-npm.yml` was deleted. **Register `release.yml` only** (done
  2026-06-25); it serves all three lines. `id-token: write` is granted in the caller +
  reusable. (If OIDC ever fails to match — npm/documentation #1755 — inline the
  `release-npm.yml` jobs into `release.yml`.)
- **Provenance forces build-in-publish-job across two OSes.** `--provenance` attests
  artifacts built in the *same* job, but the Android `.so` needs ubuntu and the iOS
  xcframework needs macos-26. So every npm publish (stable, canary, rc) is a **three-job**
  shape mirroring `build-mobile.yml`:
  1. `android-artifacts` (ubuntu): `turbo build` (codegen) + `turbo build:android` → upload
     `jniLibs` + `src/generated` + `cpp/generated`.
  2. `ios-artifacts` (macos-26): `turbo build:ios` → upload `shim_uniffi.xcframework`.
  3. `publish` (ubuntu, `needs` both, `id-token: write`): download both into the package,
     install npm@latest, `changeset version [...]`, then `npm publish --provenance`.
- **`.changeset/config.json` / package privacy:** remove `private: true` from the terminal
  package; set its **`publishConfig.access: "public"`** (per-package; do **not** flip the
  global `restricted`); keep `privatePackages: { version, tag }` for `@fressh/mobile`.
  Confirm `catalog:` peer deps (react 19.2.3, react-native 0.85.3) resolve to concrete
  ranges on publish.

---

## Canary releases (snapshot)

Snapshot = stateless, throwaway, per-commit "install-and-test" builds. No committed bump,
no changelog, no git tag. `changeset version --snapshot canary` → base `0.0.0` so a canary
can never satisfy/outrank a real `^0.1.0` range; publish to a **dedicated `canary`
dist-tag** so `bun add @fressh/react-native-terminal` never resolves it.

- **npm package** — the `publish-terminal-canary` job **in `release.yml`** (workflow_dispatch
  + push to a `canary` branch) calls reusable `release-npm.yml` with `snapshot: true`,
  `npm-tag: canary` — the three-job build+publish shape above. Publish step:
  `bun run version:snapshot` (= `changeset version --snapshot canary`, throwaway tree) then
  `npm publish --provenance --access public --tag canary`. (Use `npm` directly, not `changeset
  publish`, so provenance + the explicit dist-tag are honored.) Version →
  `0.0.0-canary-<commit-short>`. Consumers: `bun add @fressh/react-native-terminal@canary`.
  **Lives in `release.yml`, not a separate file, so npm's single trusted publisher covers it.**
- **app** — `changeset version --snapshot canary` **also versions the private app** (only
  `publish` skips private packages). So `canary-app.yml` (thin caller of `build-mobile.yml`,
  `submit: true`, `release-tag: ''`) derives a canary version and builds → TestFlight / Play
  internal, **no npm**. ⚠️ Gated on the build-number fix below.
- **Config:** add a `snapshot` block to `.changeset/config.json`:
  `{ "useCalculatedVersion": false, "prereleaseTemplate": "canary-{commit-short}" }`.

---

## Prerelease line (pre mode / rc)

Pre mode = a sustained, sequenced, changelogged, git-tagged prerelease line you intend to
**graduate** to stable. Use for a deliberate pre-1.0 beta cohort; canary covers day-to-day.

- **Run pre mode ONLY on a dedicated non-default branch** (e.g. `prerelease`). `changeset
  pre enter rc` writes `.changeset/pre.json` (commit it **on that branch only**). `changeset
  version` → `x.y.z-rc.N`; `changeset publish` **auto-uses the `rc` dist-tag** (you must
  **not** pass `--tag` in pre mode — it hard-errors).
- **`release.yml` also runs on `push: [prerelease]`** (rather than a duplicate file): there
  its `publish-terminal` job publishes to the **`rc`** dist-tag (npm-tag computed from the
  branch), and — because private packages are versioned in pre mode and `privatePackages.tag`
  cuts the tag — it also drives `@fressh/mobile@x.y.z-rc.N` → `build-mobile.yml` (rc tag,
  `submit: true`) → internal channels.
- **Graduate:** on the branch, `changeset pre exit` → next `changeset version` strips the
  `-rc.N` suffix and **deletes `pre.json`** + consumed changesets → merge `prerelease` →
  `main` → `release.yml` cuts the clean stable `x.y.z` to `latest`.
- 🚫 **HARD RULE: `pre.json` must NEVER reach `main`** — it would put the whole monorepo into
  pre mode and block all stable releases.

---

## App build-number — store-derived (fastlane first-party)

`apps/mobile/app.config.ts`, `changelog-extract.ts`, and `fastlane/Fastfile` carried a strict
3-part `semverToCode`. A prerelease/snapshot version (`0.0.0-canary-…`, `0.2.0-rc.0`)
collapses the patch token to `0`, so every such build got the **same** build number →
Play/TestFlight reject duplicates; `changelog-extract.ts` also **threw** on the non-3-part
string. Fixed with fastlane's **store-derived** build numbers (the `listening-astro` pattern):

- **iOS** — the Fastfile `build`/`release` lanes set the build number to
  `latest_testflight_build_number(version:, initial_build_number: 0) + 1` (unique within the
  marketing version; self-corrects on re-runs). Applies to stable + canary + rc.
- **Android** — a new `next_version_code` lane computes
  `google_play_track_version_codes(...).max + 1`; the canary path in `build-mobile.yml` runs
  it (after WIF auth, before prebuild) and exports `FRESSH_VERSION_CODE`, which `app.config.ts`
  reads. Stable Android stays `semverToCode` (the promote lane is unchanged).
- **Marketing version** — `app.config.ts` (and the Fastfile) strip the prerelease suffix so
  the iOS `CFBundleShortVersionString` stays a valid dotted triple.
- **`changelog-extract.ts`** — suffix-tolerant `semverToCode`, honors `FRESSH_VERSION_CODE`
  for the Play changelog filename, and stubs (instead of throwing) when a version has no
  `## <version>` section (canary). `app.config.ts` also gains the iOS `deploymentTarget: "16.4"`
  floor.

---

## Config + script changes (summary)

`.changeset/config.json`: add the `snapshot` block (above). Keep global `access: "restricted"`.

Root `package.json` scripts:
```jsonc
"release":          "changeset publish",                       // stable: publishes terminal + tags mobile
"version:snapshot": "changeset version --snapshot canary",
"publish:snapshot": "changeset publish --snapshot --tag canary --no-git-tag", // local/no-provenance convenience
"pre:enter":        "changeset pre enter rc",
"pre:exit":         "changeset pre exit"
// keep existing "version" and "tag"
```

`packages/react-native-terminal/package.json`: remove `private: true`; `version: "0.1.0"`;
add `publishConfig: { access: "public" }`.

---

## Implementation phases (as built)

> All code phases below are **done**; the **Handoff** section above is the authoritative
> remaining-steps list (manual bootstrap, trusted-publisher setup, first CI run).

0. ✅ **Package publish-readiness**: un-private; `0.1.0`; `publishConfig.access: "public"`;
   `files[]` ships inline binaries + codegen (narrowed `android` glob; dropped `rust`/`lib`);
   peer deps → ranges.
1. ✅ **Config + scripts**: `snapshot` block + root scripts.
2. ✅ **OIDC stable publishing**: bootstrap-published `0.1.0` (manual, no provenance) +
   registered the single `release.yml` trusted publisher on npmjs.com (2026-06-25). Reusable
   `release-npm.yml` (3-job) + an additive `publish-terminal` job in `release.yml`;
   `id-token: write` in both.
3. ✅ **Canary consolidated into `release.yml`** (`publish-terminal-canary` job, dispatch /
   push `canary`) → `release-npm.yml` with `snapshot: true`, `npm-tag: canary`. Standalone
   `canary-npm.yml` **deleted** (npm allows only one trusted-publisher caller per package).
4. ✅ **App build-number**: fastlane store-derived (iOS `latest_testflight_build_number`,
   Android `google_play_track_version_codes` via `FRESSH_VERSION_CODE`) + suffix-stripping +
   changelog stub.
5. ✅ **`canary-app.yml`**: thin `build-mobile.yml` caller (`canary: true`, `submit: true`).
6. ✅ **rc line**: `release.yml` extended to the `prerelease` branch (no separate file);
   `pre.json` lives only on that branch.
7. ✅ **Docs/badges**: consumer README + root npm badge + this doc.

---

## Command cheatsheet

```sh
# STABLE release (existing two-mode flow): author a changeset → merge → merge the Version PR.
bun run changeset

# npm CANARY: Actions → "Version & Release" → Run workflow (or push to `canary`); needs a
#   pending changeset. → 0.0.0-canary-<commit> on @canary.
bun add @fressh/react-native-terminal@canary     # consumers

# app CANARY build → TestFlight/Play internal: Actions → "Canary app" (needs build-number fix).

# PRERELEASE (rc) — on a NON-default branch:
git checkout -b prerelease && bun run pre:enter   # writes .changeset/pre.json (commit on this branch)
#   author changesets → release.yml (on prerelease) publishes x.y.z-rc.N to @rc + builds app rc
bun add @fressh/react-native-terminal@rc          # consumers
# GRADUATE: bun run pre:exit → version strips -rc.N + deletes pre.json → merge prerelease → main
```
🚫 Never `changeset publish --tag` in pre mode; never `--snapshot` in pre mode; never let
`pre.json` reach `main`; provenance publishes need npm ≥ 11.5.1 (not `bun publish`).

---

## Open questions remaining

- **Stable terminal publish — DECIDED:** reusable `release-npm.yml` (3-job build+publish)
  invoked by a small additive `publish-terminal` job in `release.yml`. The app's stable
  build/submit flow is unchanged.
- **Canary frequency vs tarball weight.** Each canary ships the full inline-binary tarball
  (~tens of MB) + burns the cross-OS artifact handoff. Fine for manual/PR-gated canaries;
  revisit if canaries become per-commit.
- **Canary version ordering.** `canary-{commit-short}` isn't time-ordered (the `@canary`
  dist-tag still always points at the latest publish). Switch to `{datetime}` only if you
  need orderable version strings (and accept same-second collisions).
- **Separate per-platform binary packages (Skia model)** remain the escape hatch if inline
  coupling/size becomes painful later.
- **App↔terminal version coupling — DECIDED (keep cascade).** `apps/mobile` depends on the
  terminal via `workspace:*`, which changesets treats as a pinned dep, so a stable/rc terminal
  bump cascades a patch bump to `@fressh/mobile` → its tag → an app build+submit to the test
  channels. **This is intended:** the app bundles the terminal *from source*, so a new terminal
  version really is a new app binary; releasing them together keeps the store app honest.
  (Canary publishes do **not** cascade — the snapshot version is throwaway and the canary job
  never builds the app.) **Escape hatch (verified 2026-06-25):** changing mobile's dep to
  `workspace:^` decouples patch/minor terminal releases — a terminal patch then leaves
  `@fressh/mobile` at its current version with no app build (a *major* terminal bump would still
  cascade). Switch to caret only if frequent npm-only patch releases make the app rebuilds a
  burden.

## References

- `docs/cloned-repos-as-docs/changesets/docs/{prereleases,snapshot-releases,versioning-apps,automating-changesets}.md`
- `docs/cloned-repos-as-docs/react-native-skia` (inline vs separate-package precedent)
- `docs/cloned-repos-as-docs/expo` (config plugins run only at prebuild; autolinking is independent)
- `docs/projects/complete/ci-building-and-releasing.md` — the changesets + two-mode `release.yml` design.
- `.github/workflows/{release,build-mobile,ship-prod}.yml`, `.changeset/config.json`.
- npm docs: trusted publishing (OIDC) + publish provenance (npm ≥ 11.5.1).
