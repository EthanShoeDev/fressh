# Future project: CI building & releasing — EAS builds + changesets changelog + GitHub Releases

**Status:** FOUNDATION LANDED — the shared changesets + secretspec foundation is implemented
(changesets configured, release-it removed, `release.yml` Version-Packages PR active,
`secretspec.toml` declared, `signed-build.ts` reads signing secrets from env). **Build track not
started** — decided **Track A (EAS)** as the v1 target; EAS scaffolding (`eas.json`, build/release
workflow) is the next phase. This doc proposes a build/release pipeline for `apps/mobile`.
The **changelog flow (changesets)** is shared and tool-agnostic; the **build/release** half is
written as **two tracks** so we can start simple and migrate without redoing the changelog work:

- **Track A — everything through EAS** (EAS Build + EAS Workflows + EAS Submit). Recommended for v1.
- **Track B — custom: GitHub Actions + Fastlane** (self-managed signing/runners). The escape hatch
  if EAS cost/limits/control become a problem.

Both tracks consume the **same changesets-produced version + git tag** and attach artifacts to the
**same GitHub Release**.

**Scope:** `apps/mobile` + repo-root CI (`.github/`, `.eas/`, `fastlane/`, `.changeset/`,
`secretspec.toml`). No native code changes.

---

## Did EAS prescribe a changelog flow? No.

A full read of the local Expo docs (`docs/cloned-repos-as-docs/expo/docs/pages/`) found **Expo
prescribes no changelog/release-notes workflow**. The only release-notes touchpoint in all of EAS is
the **TestFlight `changelog` field**, settable in an EAS Workflows `submit`/`testflight` job:

```yaml
submit_ios:
  type: submit
  params: { platform: ios, profile: production }
  # the TestFlight "What to Test" note is the only EAS-native release-notes field
```

So changelog generation is entirely on us — which is why **changesets is independent of the build
track** and works identically under Track A or B.

---

## Current state (what exists today)

- **Builds:**
  - Local Android signing via `apps/mobile/scripts/signed-build.ts` — pulls the keystore from
    **Bitwarden** (`bw get item "fressh keystore"`), runs `prebuild:clean`, then
    `gradlew bundleRelease`/`assembleRelease`. Android-only. iOS has no signed/distribution path.
  - `ios/` is committed; `android/` is CNG (prebuild-generated, gitignored). Expo SDK 56, RN 0.85.
- **Releases / changelog:** `release-it` + `@release-it/conventional-changelog` (`conventionalcommits`
  preset) — see `apps/mobile/.release-it.ts`. Tags `@fressh/mobile-v${version}`, creates a GitHub
  Release, attaches the APK, generates `apps/mobile/CHANGELOG.md` **from conventional commits**.
  → This is exactly the conventional-commit flow we want to drop.
- **Versioning:** `app.config.ts` already derives `versionCode`/`buildNumber` deterministically from
  the `package.json` semver (`maj*10000 + min*100 + pat`). **Single source of truth = `package.json`
  version.** This is the cleanest indie pattern (matches `jgalat/remote-app`) — keep it.
- **CI:** `.github/workflows/check.yml` — Nix devShell + bun + `turbo lint:check` on PR/push to main.
  No tests, no build, no e2e in CI. `.github/disabled_workflows/release.yml` is a stale stub that
  references `changesets/action` with **pnpm** commands (we use bun) — it's the seed of this plan.
- **e2e/screenshots:** Maestro (`apps/mobile/test/e2e/`) + `scripts/screenshots.ts`.

---

## Goals

1. **Cloud / automated builds** (iOS + Android) without babysitting a Mac.
2. **Publish build artifacts to GitHub Releases** (installable APK + IPA, optionally AAB).
3. **Changelog flow like changesets** — human-written changeset files in PRs, *not* conventional
   commits — driving the version bump, `CHANGELOG.md`, and the git tag.
4. Keep a viable **migration path between EAS and Fastlane** without rewriting the changelog flow.

---

## Foundation (shared by both tracks): changesets changelog flow

Changesets officially supports versioning a **private, non-npm "application"** package — see the
local clone `docs/cloned-repos-as-docs/changesets/docs/versioning-apps.md`. The documented pattern:
set `privatePackages: { version: true, tag: true }`, and "trigger releases for other package formats
by creating workflows which trigger on **tags/releases being created by changesets**." That tag is
our hand-off point to whichever build track.

1. **Add changesets:**
   ```bash
   bun add -D @changesets/cli
   bunx changeset init     # creates .changeset/config.json + README
   ```
2. **`.changeset/config.json`** (version + tag, private app, no npm publish):
   ```jsonc
   {
     "$schema": "https://unpkg.com/@changesets/config/schema.json",
     "changelog": ["@changesets/changelog-github", { "repo": "EthanShoeDev/fressh" }],  // PR/author links (uses Actions GITHUB_TOKEN)
     "commit": false,
     "access": "restricted",
     "baseBranch": "main",
     "updateInternalDependencies": "patch",
     "privatePackages": { "version": true, "tag": true },  // tag:true → git tag we trigger builds from
     "ignore": []   // only apps/mobile participates today; web/packages can join later
   }
   ```
   - `apps/mobile` stays `"private": true` → `changeset publish` skips it. We never publish to npm.
3. **Scripts:**
   ```jsonc
   "changeset": "changeset",
   "version": "changeset version && bun install --lockfile-only"  // bun.lock sync is REQUIRED — changeset version doesn't touch it
   ```
   `changeset version` bumps `apps/mobile/package.json` + writes `apps/mobile/CHANGELOG.md`; then
   `app.config.ts` derives `versionCode`/`buildNumber` automatically. No `autoIncrement` anywhere.
4. **Author workflow:** contributors run `bunx changeset` in feature PRs, pick patch/minor/major, and
   write the changelog entry as markdown:
   ```markdown
   ---
   "@fressh/mobile": minor
   ---
   Add ED25519 key import to the key manager.
   ```
5. **The "Version Packages" PR** — `.github/workflows/release.yml` (driven by **bun**, replacing the
   stale pnpm stub):
   ```yaml
   name: Release
   on: { push: { branches: [main] } }
   permissions: { contents: write, pull-requests: write }
   jobs:
     version:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
         - run: bun install --frozen-lockfile
         - uses: changesets/action@v1
           with:
             version: bun run version       # bumps package.json + CHANGELOG + bun.lock
             # publish: omitted — no npm publish for a private app
             commit: "chore: version packages"
             title: "Version Packages"
           env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
   ```
   Merging the auto-opened **"Version Packages" PR** lands the bumped version on `main`, and (because
   `tag: true`) a `@fressh/mobile@${version}` tag is produced. **That tag triggers the build track.**
   > **Tag format:** in this multi-package monorepo, changesets tags as `<pkgName>@<version>` →
   > `@fressh/mobile@0.0.5` (the old release-it `@fressh/mobile-v0.0.5` `-v` form is gone). Build-track
   > workflow triggers below use the `@fressh/mobile@*` glob to match.
6. **Remove the old flow:** delete `apps/mobile/.release-it.ts`, drop `release-it` +
   `@release-it/conventional-changelog` (from `apps/mobile/package.json` + root catalog) and the
   `release`/`release:dry` scripts. Keep the existing `apps/mobile/CHANGELOG.md` (changesets prepends).

> **Note on the tag:** the changesets git step is what creates the tag. If you prefer the release job
> to own tagging, set `privatePackages.tag: false` and create the tag explicitly in the build job
> after detecting the version change. Either is fine; `tag: true` is simpler.

---

## Foundation (shared by both tracks): secrets management with secretspec

Production builds need real secrets — EAS auth token, the Android upload keystore, App Store Connect
API key, Fastlane `match` password, etc. Rather than scattering these across GitHub Secrets,
`signed-build.ts`'s hardcoded `bw get item`, and ad-hoc env vars, we declare them once with
**[secretspec](https://secretspec.dev)** (local clone: `docs/cloned-repos-as-docs/secretspec/`).

**Why secretspec fits here:**
- **Declaration vs storage split** — commit a `secretspec.toml` listing *what* secrets exist (names,
  descriptions, which profile requires them); values live in a provider backend, never in git.
- **`env` provider is read-only, built for CI** — in GitHub Actions we map GitHub Secrets → env vars,
  and secretspec reads them. Locally we use keyring / 1Password / Bitwarden.
- **Per-secret provider fallback chains** make *one* file work everywhere:
  `providers = ["env", "keyring"]` → env in CI, keyring on a laptop. No CI-vs-local divergence.
- **`secretspec check`** is a clean pre-build CI gate ("are all required production secrets present?").
- **`secretspec run -- <cmd>`** injects secrets as env vars into the build command — so EAS/Fastlane
  just read `process.env` / ENV, decoupled from where the value came from.
- **Nix-native** (it's from the devenv/Cachix folks) — installs cleanly into our `flake.nix` devShell.

### Secrets we need

| Secret | Used by | Profile | Notes |
|---|---|---|---|
| `EXPO_TOKEN` | Track A (EAS auth) | production | from expo.dev account settings |
| `FRESSH_ANDROID_KEYSTORE_BASE64` | both (Android signing) | production | base64 of the upload keystore (today: Bitwarden) |
| `FRESSH_ANDROID_KEYSTORE_PASSWORD` | both | production | |
| `FRESSH_ANDROID_KEY_ALIAS` | both | production | |
| `FRESSH_ANDROID_KEY_PASSWORD` | both | production | |
| `ASC_API_KEY_P8` / `ASC_KEY_ID` / `ASC_ISSUER_ID` | iOS submit (both) | production | App Store Connect API key |
| `MATCH_PASSWORD` / `MATCH_GIT_URL` | Track B only (Fastlane `match`) | production | iOS cert/profile encryption |
| `GITHUB_TOKEN` | release upload | — | provided natively by Actions; no need to declare |

### `secretspec.toml` (in `apps/mobile/`)
```toml
[project]
name = "fressh-mobile"
revision = "1.0"

# Provider aliases (checked in → every dev + CI runner sees them).
# CI sets the secrets as env vars from GitHub Secrets; laptops fall back to keyring (or bao, below).
[providers]
env     = "env://"
keyring = "keyring://"
# Likely future backend — self-hosted OpenBao (secretspec's vault:// provider).
# Synced across machines + usable from CI, all self-hosted. See decision #6.
# bao   = "vault://https://bao.fressh.dev/secret/fressh"

[profiles.default]
# dev builds need none of the signing/store secrets

[profiles.production]
EXPO_TOKEN                       = { description = "EAS auth token",            required = true, providers = ["env", "keyring"] }
FRESSH_ANDROID_KEYSTORE_BASE64   = { description = "base64 upload keystore",    required = true, providers = ["env", "keyring"] }
FRESSH_ANDROID_KEYSTORE_PASSWORD = { description = "keystore password",         required = true, providers = ["env", "keyring"] }
FRESSH_ANDROID_KEY_ALIAS         = { description = "key alias",                 required = true, providers = ["env", "keyring"] }
FRESSH_ANDROID_KEY_PASSWORD      = { description = "key password",              required = true, providers = ["env", "keyring"] }
ASC_API_KEY_P8                   = { description = "App Store Connect .p8",     required = false, providers = ["env", "keyring"] }
ASC_KEY_ID                       = { description = "ASC key id",                required = false, providers = ["env", "keyring"] }
ASC_ISSUER_ID                    = { description = "ASC issuer id",             required = false, providers = ["env", "keyring"] }
```

### Local usage (replaces `signed-build.ts`'s hardcoded Bitwarden call)
```bash
secretspec config init        # one-time: pick keyring as the local provider
# import the keystore values once (from Bitwarden today) into keyring:
secretspec set FRESSH_ANDROID_KEYSTORE_BASE64
# then wrap any build in secretspec so signing values arrive as env vars:
secretspec run --profile production -- bun run build:signed:aab
```
Refactor `signed-build.ts` to read the keystore from `process.env.FRESSH_ANDROID_KEYSTORE_BASE64`
(injected by `secretspec run`) instead of shelling out to `bw` directly — that decouples it from the
storage backend and makes it work identically in CI.

### CI usage (GitHub Actions, both tracks)
```yaml
- run: curl -sSL https://install.secretspec.dev | sh   # or via Nix devShell
- run: secretspec check --profile production            # fail fast if a secret is missing
- run: secretspec run --profile production -- eas build --profile production --platform all --non-interactive
  env:   # GitHub Secrets → env, picked up by the env:// provider
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
    FRESSH_ANDROID_KEYSTORE_BASE64: ${{ secrets.FRESSH_ANDROID_KEYSTORE_BASE64 }}
    FRESSH_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.FRESSH_ANDROID_KEYSTORE_PASSWORD }}
    # ...etc
```

> **Migrating off the `bw` CLI (DECIDED → keyring):** `signed-build.ts` currently uses the
> **personal-vault `bw` CLI**, which is **not** a secretspec provider. secretspec's only Bitwarden
> provider is **`bws` = Bitwarden *Secrets Manager***, and **`bws` is ruled out**: we self-host
> **Vaultwarden**, which implements the password-vault API but **not** the Secrets Manager endpoints
> `bws` requires. (1Password was also a candidate but isn't in use.) So we **drop the `bw get item`
> call** from `signed-build.ts` and store the keystore values in the **local keyring** (`keyring://`,
> free, OS keychain). CI uses the `env` provider (GitHub Secrets) regardless. One-time migration:
> export the keystore + passwords from Vaultwarden → `secretspec set` into keyring → add the same
> values as GitHub Secrets.
>
> **Likely backend: OpenBao.** We may stand up **self-hosted OpenBao** (the open-source Vault fork)
> as the real secret backend — it's secretspec's **`vault://`** provider. This fits the self-hosting
> posture, removes keyring's machine-local downside (syncs across machines), and can back **both**
> local dev *and* CI (CI authenticates to OpenBao instead of, or alongside, GitHub Secrets). If
> adopted, only the provider **alias** changes in `secretspec.toml` (`bao = "vault://…"`) and the
> per-secret chains become e.g. `["env", "bao"]` — the secret declarations and build commands are
> unchanged. Start on keyring (zero setup) and switch to OpenBao when it's running.

---

## Track A — everything through EAS  *(recommended for v1)*

**When to pick:** fastest to stand up, no Mac, EAS manages signing. Free tier covers a solo dev
(~15 iOS + 15 Android low-priority builds/mo, Submit + Workflows included; Starter $19/mo ≈ $45 build
credit if the queue is annoying). *(Verify live dollar figures at expo.dev/pricing — rev. 2026-05-30.)*

### A1. Setup (run from `apps/mobile/`, the EAS project root in a monorepo)
```bash
bun add -g eas-cli            # or bunx eas-cli ...
eas login
eas init                      # creates EAS project + projectId (→ app.config.ts extra.eas)
eas build:configure           # scaffolds apps/mobile/eas.json
```

### A2. `apps/mobile/eas.json`
```jsonc
{
  "cli": {
    "version": ">=12.0.0",
    "appVersionSource": "local",   // keep our semver-derived versionCode/buildNumber
    "requireCommit": true           // CI builds only from committed state
  },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "ios": { "simulator": true } },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" } },  // installable testers builds
    "production":  { "android": { "buildType": "app-bundle" }, "ios": { "resourceClass": "m-medium" } }
  },
  "submit": { "production": {} }    // fill ascAppId / Play track once stores exist
}
```
- **No `autoIncrement`** — `app.config.ts` already derives build numbers from semver, and with
  `appVersionSource: "local"` those values are authoritative.

### A3. Credentials
On first `eas build`, EAS generates/stores the Android keystore + iOS dist cert + provisioning
profile (managed). **Decision:** upload our existing Bitwarden keystore via `eas credentials` so the
Play **upload key** doesn't change. Keep `signed-build.ts` for local builds.

### A4. Build + release on tag — `.eas/workflows/release.yml`
```yaml
name: Production builds
on: { workflow_dispatch: {} }    # invoked by the GH Actions release job below (on tag)
jobs:
  build_android: { type: build, params: { platform: android, profile: production } }
  build_ios:     { type: build, params: { platform: ios,     profile: production } }
  # optional: submit_android / submit_ios jobs (type: submit) for store upload
```
GH Actions job that runs on the changesets tag → triggers the EAS build, waits, uploads artifacts:
```yaml
release_artifacts:
  needs: version
  if: startsWith(github.ref, 'refs/tags/@fressh/mobile@')
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: expo/expo-github-action@v8
      with: { eas-version: latest }   # EXPO_TOKEN comes via secretspec, not here
    - run: secretspec check --profile production
    - run: |
        secretspec run --profile production -- \
          eas build --profile production --platform all --non-interactive --wait
        # download finished artifacts (eas build --json gives URLs) then:
        gh release create "$GITHUB_REF_NAME" --notes-from-tag || true   # reuse if changesets made it
        gh release upload "$GITHUB_REF_NAME" app-release.apk Fressh.ipa --clobber
      env:   # GitHub Secrets → env:// provider
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        FRESSH_ANDROID_KEYSTORE_BASE64: ${{ secrets.FRESSH_ANDROID_KEYSTORE_BASE64 }}
        # ...remaining production secrets
```
- **Gotcha:** upload to the *existing* tag's release; don't recreate it or you clobber the notes.

### A5. Cost-optimized EAS variant (Bluesky pattern)
Keep `eas.json` but run `eas build --local` *on GitHub-hosted runners* (macOS for iOS, Ubuntu for
Android) → pay GH Actions minutes instead of EAS Build minutes, while keeping EAS signing/submit.
A good middle step between A4 and Track B.

---

## Track B — custom: GitHub Actions + Fastlane

**When to pick:** EAS minutes get expensive (many dozens of builds/mo), you need custom native build
steps, or you want full control of signing. This is how Expensify and Rocket.Chat (both Expo-SDK
apps) ship. More setup, zero EAS cost, you own the macOS runner + signing.

### B1. Prereqs
- Add `fastlane` (Gemfile/`bundle`). iOS uses a **committed `ios/`** (already present) + CocoaPods;
  Android is **CNG** so the job must run `bun run prebuild` (or `expo prebuild -p android`) to
  generate `android/` before building — mirror what `signed-build.ts` already does.
- Signing: **iOS** via Fastlane `match` (certs/profiles in a private git repo or EAS) or App Store
  Connect API key; **Android** via the Bitwarden keystore (reuse `signed-build.ts`'s
  Bitwarden→base64→`android/app/*.keystore` logic, or store the keystore as a GH secret).

### B2. `fastlane/Fastfile` (sketch)
```ruby
platform :ios do
  lane :release do
    setup_ci                                   # keychain on CI
    match(type: "appstore", readonly: true)    # or app_store_connect_api_key + sigh
    build_app(scheme: "Fressh", export_method: "app-store")  # gym → Fressh.ipa
    upload_to_testflight(skip_waiting_for_build_processing: true)
  end
end

platform :android do
  lane :release do
    sh("cd ../.. && bun run --filter @fressh/mobile prebuild")   # CNG: generate android/
    gradle(task: "bundle", build_type: "Release", project_dir: "apps/mobile/android")  # → .aab
    gradle(task: "assemble", build_type: "Release", project_dir: "apps/mobile/android") # → .apk for GH release
    upload_to_play_store(track: "internal", aab: "...app-release.aab")
  end
end
```

### B3. `.github/workflows/release-fastlane.yml` (triggered by the changesets tag)
```yaml
on: { push: { tags: ['@fressh/mobile@*'] } }
jobs:
  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: ruby/setup-ruby@v1
        with: { bundler-cache: true }
      - run: secretspec run --profile production -- bundle exec fastlane android release
        env:   # GitHub Secrets → env:// provider (secretspec injects them into fastlane)
          FRESSH_ANDROID_KEYSTORE_BASE64: ${{ secrets.FRESSH_ANDROID_KEYSTORE_BASE64 }}
          FRESSH_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.FRESSH_ANDROID_KEYSTORE_PASSWORD }}
          # ...alias/key password
      - run: gh release upload "$GITHUB_REF_NAME" .../app-release.apk --clobber
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
  ios:
    runs-on: macos-15            # macOS runner required for iOS — the cost driver
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: ruby/setup-ruby@v1
        with: { bundler-cache: true }
      - run: secretspec run --profile production -- bundle exec fastlane ios release
        env:   # GitHub Secrets → env:// provider
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
          ASC_API_KEY_P8: ${{ secrets.ASC_API_KEY_P8 }}
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
      - run: gh release upload "$GITHUB_REF_NAME" Fressh.ipa --clobber
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

### B4. Tradeoffs vs Track A
- **Pro:** no EAS Build bill; full control; reuse the existing Bitwarden keystore directly.
- **Con:** you own macOS-runner minutes (~10× Linux), Xcode/CocoaPods upkeep, and iOS signing (the
  hardest part — `match` setup). Per-build macOS-runner cost is roughly comparable to EAS's $2–4/iOS
  build, so the win is control + volume, not small-scale savings.

---

## Migration path (why two tracks, one changelog)

The changesets foundation produces `package.json` version + `CHANGELOG.md` + git tag regardless of
build track. Track A and Track B both: (1) trigger on the `@fressh/mobile@*` tag, (2) build, (3)
`gh release upload` to that tag's release. So switching A→B (or running both during a transition) is
**just swapping which workflow listens to the tag** — no changelog rework. Start on **Track A**;
adopt **A5 (`--local`)** if minutes bite; go full **Track B** only if you need the control.

---

## Phase: extend CI quality gates (optional, parallel)

- Add a `test`/`e2e` job: Maestro on a `preview` build — `type: maestro` EAS Workflow job (Track A) or
  a Maestro step on a self-built APK (Track B). Today CI is lint-only.
- Wire `scripts/screenshots.ts` into a preview build for store assets if desired.

---

## Open decisions (for the user)

1. **Track A vs B for v1.** Recommended: **Track A (EAS)** — least setup, free tier viable. Keep B
   documented as the escape hatch.
2. **EAS Workflows vs GH Actions calling `eas build`** (within Track A). Recommended: EAS Workflows
   (free, integrated). Either keeps changesets + release wiring in GH Actions.
3. **Reuse the Bitwarden keystore** (upload to EAS / feed to Fastlane) vs let EAS generate a new one.
   Recommended: reuse, to preserve the Play upload key.
6. **secretspec backend** — migrating off the `bw` CLI (`bws` ruled out: self-hosted Vaultwarden has
   no Secrets Manager endpoints). **Near-term: keyring** (free, OS keychain, machine-local) + `env`
   (GitHub Secrets) in CI. **Likely target: self-hosted OpenBao** via the `vault://` provider —
   syncs across machines and can back both local + CI. Switching backends only changes a provider
   alias in `secretspec.toml`; declarations/commands are unchanged. Open sub-question: stand up
   OpenBao now, or ship on keyring first?
4. **Which artifacts on GitHub Releases:** APK + IPA are installable/sideloadable; AAB is store-only.
   Recommended: attach **APK + IPA** (+ AAB optionally).
5. **iOS distribution target now:** TestFlight via submit, or just attach the IPA to GH Releases until
   an Apple Developer account / store presence exists?

---

## References

- Local Expo docs clone: `docs/cloned-repos-as-docs/expo/docs/pages/{build,submit,eas,eas-update,app-signing,billing}/`
- Local changesets clone: `docs/cloned-repos-as-docs/changesets/docs/` — esp. `versioning-apps.md`,
  `config-file-options.md`, `automating-changesets.md`.
- Local secretspec clone: `docs/cloned-repos-as-docs/secretspec/` (README + `docs/src/content/docs/`)
  — esp. providers (`env`, `keyring`, `bws`, `onepassword`), profiles, and per-secret provider chains.
  Site: secretspec.dev.
- changesets/action: github.com/changesets/action
- Reference impls: `obytes/react-native-template-obytes` (cleanest indie EAS blueprint),
  `bluesky-social/social-app` (`eas build --local` + OTA), `jgalat/remote-app` (our versionCode
  trick), `Expensify/App` & `RocketChat/Rocket.Chat.ReactNative` (Fastlane + GH Actions, Track B).
