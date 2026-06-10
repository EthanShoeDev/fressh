# CI building & releasing — fastlane (Track B) + changesets changelog + GitHub Releases

**Status (rev 2026-06-10 pm): FULL FASTLANE (Track B) DECIDED & WIRED — EAS dropped entirely.**
The Track A5 hybrid (`eas build --local` on GH Actions) was implemented and Android-verified first,
then superseded the same day: once prod shipping + store-listings-as-code forced fastlane into the
stack anyway (`eas submit` can't submit iOS for App Review, can't set Play release notes, and
`eas metadata` is Apple-text-only/no screenshots/no Play), EAS's remaining value was just managed
iOS signing — covered by storing the dist cert + provisioning profile in OpenBao (the iOS twin of
the Android keystore; no match repo needed) and creating them via fastlane `cert`/`sigh` with an
ASC API key. So: **no Expo account, no EXPO_TOKEN, no eas.json/.easignore/requireCommit**.
`expo prebuild` (CNG, account-free) stays.

**What's wired now:** changesets versioning → `release.yml` (Version-Packages PR → tag + GH Release
→ reusable `build-mobile.yml`) → Android `scripts/signed-build.ts` (prebuild + OpenBao/GH-secret
keystore + gradle) / iOS `expo prebuild + fastlane gym` (bao-stored cert+profile) → fastlane `supply`/`pilot`
to Play-internal/TestFlight with changesets release notes → **`ship-prod.yml` promote button**
(supply track-promote + deliver submit-for-review). Store listings live in git
(`apps/mobile/fastlane/metadata` + `screenshots`). fastlane comes from the Nix devShell.

> The Track A/B framing and EAS sections below are retained as **historical background** — the
> "What we're doing & why" section documents the A5 hybrid era. The current design is this header,
> the "Release flow" section, and the runbook.

- **Track A — everything through EAS** (EAS Build + EAS Workflows + EAS Submit). *(historical)*
- **Track A5 — `eas build --local` on GitHub Actions.** *(historical — implemented 2026-06-10 am,
  Android-verified, superseded the same day)*
- **→ CHOSEN: Track B — GitHub Actions + fastlane** (bao-stored signing, gradle/gym builds,
  pilot/supply/deliver submission, listings-as-code), orchestrated by turbo.

**Scope:** `apps/mobile` + repo-root CI (`.github/`, `apps/mobile/fastlane/`, `.changeset/`,
`secretspec.toml`, `flake.nix`). No native code changes.

---

## Release flow  *(decided 2026-06-10: trunk + auto-beta + promote button)*

Modeled on what the automation-mature OSS RN apps converged on (researched 2026-06-10 against
their repos): **Bluesky** (trunk; every main merge auto-ships to TestFlight; prod = manual
`workflow_dispatch`; hotfixes via `1.x.0-ota-N` branches cherry-picked off the shipped tag) and
**Expensify** (trunk; bot fast-forwards a `staging` pointer branch per merge; closing the QA
checklist issue promotes the *same staging binaries* to production; hotfixes via a cherry-pick
workflow). Rocket.Chat RN is the gitflow holdout (develop/master) — also the one without OTA and
with manual console promotion. fastlane itself is branching-agnostic (lanes map to destinations,
not branches).

**The flow:**

1. **Feature PRs → `main`** (with a changeset file). Merging to main releases nothing; the
   changesets bot accumulates pending bumps in one open **"Version Packages" PR** — the release
   train lever.
2. **Merge the Version Packages PR = cut a release.** Tag + GitHub Release + builds attached +
   **auto-submit to the test channels**: Play internal track (`fastlane android beta`) and
   TestFlight (`fastlane ios beta`), release notes = that version's CHANGELOG section. Production
   users see nothing. Main being ahead of prod is the normal permanent state; features not ready
   for users ride along dark (feature-flag them if even testers shouldn't see them).
3. **Prod = the promote button.** `ship-prod.yml` (`workflow_dispatch`, input: version) promotes
   the EXACT soaked artifacts — Play: `supply` track-promotes the versionCode internal→production
   (no re-upload; Play rejects duplicate versionCodes anyway); iOS: `deliver` submits the
   already-uploaded TestFlight build for App Review with auto-release-on-approval
   (`skip_binary_upload: true`). Apple review still happens; zero console clicks. Runs on ubuntu —
   both halves are store-API calls.
4. **Hotfix while main is dirty** (the documented escape hatch, rare): branch off the shipped tag
   `git checkout -b hotfix/0.1.5 "@fressh/mobile@0.1.4"`, cherry-pick the fix, bump the patch
   version in that branch, dispatch `build-mobile.yml` against it with submit on, verify on the
   test channel, `ship-prod` it, cherry-pick back to main. An afternoon-lived branch — Bluesky's
   `ota-N` pattern.

**Why one version line (no `-beta.N`, no dev branch):** Play versionCodes are one monotonic
sequence shared across ALL tracks, and Apple rejects non-numeric `CFBundleShortVersionString` —
prerelease suffixes can't even surface on iOS. The stores model channels as *tracks*; mirroring
channels in git creates a second source of truth. Betas consume patch numbers; prod history has
gaps; users never see them. Everything here is reversible — the only one-way doors in this domain
are the versionCode encoding and the upload keystore (both settled).

**Future idea — Expensify-style deploy checklist:** instead of a bare button, Expensify's bot
opens a "StagingDeployCash" issue per release cycle listing every PR riding in it as checkboxes;
QA checks items off, deploy blockers get a label that holds the train, and *closing the issue* is
the promote trigger (restricted to their deployers team). A scaled-down version for fressh: the
release workflow opens a "Promote 0.2.0?" issue with the changeset entries as a test checklist +
links to the Play-internal/TestFlight builds, and an issue-closed workflow (gated on a label)
fires ship-prod. Nice ergonomics once there are real testers; not needed for v1 — revisit after
the first few releases.

**OTA updates (deliberately NOT wired):** dropping EAS build/submit does not foreclose OTA.
OTA = the open-source `expo-updates` client (not installed yet) + an update server, chosen later:
**hosted EAS Update** (free tier, build-pipeline-agnostic — works fine with fastlane-built
binaries; would reintroduce an Expo account + EXPO_TOKEN for that one purpose) vs **self-hosted**
(Expo publishes the updates protocol + reference server `expo/custom-expo-updates-server`;
community impls exist; fits the Vaultwarden/OpenBao posture; real work: update code-signing,
`runtimeVersion`/fingerprint discipline, serving infra). CodePush is dead (retired 2025). What OTA
buys: JS-only prod fixes in minutes instead of a review cycle (how Bluesky patches same-day) +
instant PR previews. Until then, the hotfix-branch flow covers prod fixes. Decide when real users
are waiting on review cycles.

---

## What we're doing & why  *(HISTORICAL — Track A5 era, rev 2026-06-09; superseded by Track B)*

**What:** Build the app on **GitHub Actions runners using our existing Nix devShell**, invoking
**`eas build --local`** (Track A5) — *not* EAS's cloud builders. The whole build recipe is expressed
as **turbo tasks** (`turbo build:android` / `turbo build:ios`); the GitHub workflow is a thin wrapper
that just calls turbo. We keep EAS only for the cheap, hard-to-replace parts: **managed signing
credentials** and **`eas submit`** (a free service). Changesets still owns version/tag/changelog.

**Why not EAS cloud build:** `@fressh/react-native-terminal` is a custom native module (Rust + russh
+ alacritty, exposed via **uniffi/ubrn** + **Nitro**). Its JS/C++ bindings and native libraries are
**gitignored** and regenerated by a toolchain — `cargo`, `cargo-ndk`, `ubrn`
(`uniffi-bindgen-react-native`), `nitrogen` — that lives in our Nix devShell. EAS's cloud builders
don't have that toolchain, and a cloud build proved it: it failed in the **Bundle JavaScript** phase
with `Unable to resolve module ./generated/shim_uniffi` because `packages/react-native-terminal/
src/generated/` (the ubrn TS bindings) isn't committed. Replicating the full Rust/ubrn/nitro
toolchain inside EAS's build image is a large, fragile lift. Our devShell already has it, and CI
already runs the devShell (`check.yml`), so building there is the natural, cheap path (Ubuntu Android
≈ \$0.28/build vs EAS \$1–4).

**Why the recipe lives in turbo, not the workflow:** the build order (codegen → native libs → app
build) is a property of the *project*, not of CI. Encoding it only in a GitHub workflow would (a)
drift from how we build locally and (b) rot as the native module evolves. Putting it in turbo makes
**local dev and CI build identically**, lets turbo **cache** the expensive native outputs, and
reduces the GitHub Action to `nix develop -c turbo build:android` (+ artifact upload). The order is
already modeled this way for dev/typecheck — we're extending it to release builds.

### The turbo build graph (most of this already exists)

```
@fressh/react-native-terminal
  cargo:build      (host staticlib)            ── inputs rust/**          (no output; cargo caches)
  ubrn:generate    (dependsOn cargo:build)     → src/generated, cpp/generated      [cached]
  nitro:codegen                                → nitrogen/generated                [cached]
  codegen          = dependsOn[ubrn:generate, nitro:codegen]
  build            = dependsOn[^build, codegen]        (so dependents get codegen via ^build)
  build:android    (cargo-ndk)                 → android/src/main/jniLibs/*.so      [cached]
  build:ios        (build-ios.sh)              → shim_uniffi.xcframework            [cached]

@fressh/mobile
  android / ios    dependsOn[^build, ^build:android|ios]  (DEV: expo run:*, persistent)  ── exists
  build:signed:apk dependsOn[^build, ^build:android]      (release via signed-build.ts)  ── exists
  build:android    dependsOn[^build, ^build:android]  → RELEASE artifact via `eas build --local`  ── TO ADD
  build:ios        dependsOn[^build, ^build:ios]      → RELEASE artifact via `eas build --local`   ── TO ADD
```

`turbo build:android` therefore runs, in order: the terminal package's `codegen` (ubrn + nitro) and
`build:android` (the `.so` into `jniLibs`), then the app's release build — with turbo restoring the
cached native outputs on a clean runner and rebuilding only what changed. The **only** new pieces are
the two app-level release tasks (a non-persistent generalization of the existing `build:signed:apk`).

### The GitHub Actions shape (thin caller, reusable workflow)

`build-mobile.yml` is a **reusable workflow** (`on: workflow_call` + `workflow_dispatch`). It contains
**no build steps** — it loads the devShell, runs `secretspec` for signing secrets, and calls the turbo
task. All ordering/codegen knowledge stays in turbo.

```yaml
# .github/workflows/build-mobile.yml  (shape)
on:
  workflow_dispatch: { inputs: { platform: { type: choice, options: [android, ios, all] } } }
  workflow_call:     { inputs: { platform: { type: string }, release-tag: { type: string } } }
jobs:
  android:           # if: platform in [android, all]
    runs-on: ubuntu-latest            # Rust+NDK build is fine on Linux
    steps:
      - uses: actions/checkout@v4
      - # install Nix + load .#default devShell (same as check.yml)
      - run: bun install --frozen-lockfile
      - run: secretspec run -f apps/mobile/secretspec.toml --provider env:// --profile production -- bunx turbo build:android --filter @fressh/mobile
      - if: inputs.release-tag != ''   # called from release.yml -> attach to the GH Release
        run: gh release upload "${{ inputs.release-tag }}" apps/mobile/build/fressh-android.aab --clobber
      - if: inputs.release-tag == ''   # manual dispatch -> just a workflow artifact
        uses: actions/upload-artifact@v4
  ios:               # if: platform in [ios, all]; runs-on: macos-15 (xcframework + signing)
    steps: [ checkout, nix devShell, bun install, "turbo build:ios", attach/upload ]
```

### How a release triggers the build (the GITHUB_TOKEN gotcha)

The changesets docs suggest triggering format-specific release workflows **on the tag/release that
changesets creates** (`versioning-apps.md`). We tried that (`build-mobile.yml` on `push: tags:
['@fressh/mobile@*']`) and hit a hard GitHub rule: **events created with the default `GITHUB_TOKEN`
(tag pushes, releases) do not start new workflow runs** — GitHub's recursion guard. So the
changeset-pushed tag would never have fired `build-mobile.yml`.

`effect-tanstack-start` (the reference repo) never hits this because its "release" is an inline
`changeset publish` to npm in the *same* job — nothing downstream needs to wake up. fressh's release
output is a long multi-platform **build**, which we want in its own file. Two ways to bridge:

1. **PAT** — give `changesets/action` a Personal Access Token instead of `GITHUB_TOKEN`; its tag push
   then fires `build-mobile.yml`. Minimal YAML, but a long-lived token to manage/rotate.
2. **Reusable workflow (CHOSEN)** — `release.yml`'s `publish:` step runs `changeset tag` (creates the
   tag + GitHub Release + sets `outputs.published`), then a second job in the **same run** calls
   `build-mobile.yml` via `uses:` when the `@fressh/mobile` tag was produced, passing `release-tag` so
   the artifact attaches to that Release. No token to manage; structurally identical to the inline
   npm-publish model, just factored into a callable file. `secrets: inherit` passes `EXPO_TOKEN`/`ASC_*`.

`release.yml` derives the mobile tag by selecting `@fressh/mobile` out of `publishedPackages` (a single
release can tag several packages via `privatePackages.tag` + the `updateInternalDependencies` cascade),
and only builds when the mobile app was actually part of that release.

### Store submission & shipping  *(IMPLEMENTED — fastlane, rev 2026-06-10 pm)*

All store interaction is fastlane (from the Nix devShell), lanes in `apps/mobile/fastlane/Fastfile`,
invoked via package scripts:

| script | lane | what it does |
|---|---|---|
| `submit:android` | `android beta` | `supply` → Play **internal** track, release notes from changelog file |
| `submit:ios` | `ios beta` | `pilot` → TestFlight (internal, no Apple review), what-to-test from notes |
| `promote:android` | `android promote` | `supply` track-promote versionCode internal→**production** (no re-upload) |
| `promote:ios` | `ios release` | `deliver` `skip_binary_upload` — submits the TestFlight build for App Review, auto-release |
| `ios:certs` | `ios certs` | `cert`+`sigh`: create/renew dist cert + App Store profile (then store in bao) |
| `changelog:extract` | — | CHANGELOG section → `build/release-notes.txt` + Play `changelogs/<versionCode>.txt` |

- **Secrets** (env via secretspec): `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` (supply `json_key_data` — no
  file materialization), `ASC_API_KEY_P8` (key content; the non-secret `ASC_KEY_ID`/`ASC_ISSUER_ID`
  + `APPLE_TEAM_ID` are constants in the Fastfile — `TODO_*` until runbook §D),
  `FRESSH_IOS_CERT_P12_BASE64` + `FRESSH_IOS_PROFILE_BASE64` (iOS signing material, stored in
  OpenBao/GH exactly like the Android keystore — match was dropped: it has no vault backend, and
  with bao in the stack a cert git repo + MATCH_PASSWORD + PAT would be three redundant secrets).
- **Store listings as code:** `apps/mobile/fastlane/metadata/` (iOS locale dirs + `android/en-US/`)
  and `fastlane/screenshots/` are the listings — edit in git, `deliver`/`supply` push them. Seeded
  with placeholders; wire `scripts/screenshots.ts` (maestro) output into the screenshot dirs later.
- **versionCode formula lives in THREE places** (keep in sync): `app.config.ts` `semverToCode`,
  `Fastfile` `version_code`, `scripts/changelog-extract.ts` `semverToCode`.
- **Play gotchas:** first .aab of a new app must be uploaded manually (API limitation); every Play
  upload needs a fresh versionCode → version-bump via changesets between betas; production-track
  promotion requires the store listing to be complete (one-time console setup).

### Signing / credentials (open sub-decision)

> **FINDING (rev 2026-06-10): EAS already holds the original Bitwarden upload keystore.**
> `keytool -printcert -jarfile build/fressh-android.aab` on a fresh `eas build --local` AAB shows a
> 2048-bit RSA cert valid from **2025-09-10** — the same day the bw keystore + signed-build script
> were created — while the EAS project was only linked 2026-06-09 (a freshly EAS-generated keystore
> would date from June 2026). So "upload the bw keystore to EAS" is already done; the Play upload key
> is preserved. Remaining (optional, self-hosting posture): copy the keystore values out of
> Vaultwarden into OpenBao via `secretspec set` as backup. No mobile-app release was ever published
> (only library releases), so nothing downstream depends on the old `bw` flow.

`eas build --local` signs via **EAS-managed credentials by default** (the keystore / iOS cert live on
EAS's servers). That's the simplest path and what the initial `build:android`/`build:ios` tasks use —
`secretspec run` only needs to supply `EXPO_TOKEN` (+ `ASC_*` for iOS). So in `secretspec.toml` the
`FRESSH_ANDROID_*` keystore secrets are now **`required = false`**: they're unused under EAS-managed
signing. **Caveat vs the self-hosting posture:** EAS-managed signing keeps the keystore on EAS, not in
secretspec/keyring/OpenBao. To keep signing material self-hosted, switch to a local `credentials.json`
(`eas build --local` reads it when `credentialsSource: local`) that `secretspec` materializes the
keystore + passwords into at build time — at which point the `FRESSH_ANDROID_*` secrets become
required again. iOS local signing is the harder half (cert `.p12` + provisioning profile), so a
reasonable interim split is **EAS-managed for iOS, secretspec-fed local creds for Android**. Starting
on EAS-managed for both to get a first green build; revisit before relying on it.

---

## Runbook — fastlane era: verify pipeline → first beta → first prod  *(rev 2026-06-10 pm)*

Ordered. §A burns nothing and needs no store accounts; §§C–D are one-time store/credential setup;
§E is the repeatable flow. Versions are only consumed by merging a Version-Packages PR; Play
versionCodes only burn on actual Play submission.

### A. Verify the CI pipeline (Android, no store accounts)

1. Commit + push this branch, open the PR → `check.yml` green (validates the shared setup action
   incl. fastlane in the devShell).
2. Optional pre-merge CI smoke test (workflow_dispatch needs the file on the default branch, but a
   push trigger doesn't): temporarily add `push: {branches: [refresh]}` to `build-mobile.yml`,
   push, watch the Android job produce `fressh-android-aab`; remove the trigger before merge.
   The android job needs the `FRESSH_ANDROID_*` GitHub secrets — already set ✓.
3. The changeset for 0.1.0 is already in the branch (`.changeset/refresh-ios-terminal-release.md`).
4. Merge the PR → `release.yml` opens the **Version Packages PR**. Merge that → tag
   `@fressh/mobile@0.1.0` + GitHub Release + signed AAB attached. Pipeline verified.
   (`release.yml` still passes `submit: false` — flip it in §E.)

### B. Keystore — ✅ DONE (2026-06-10)

`FRESSH_ANDROID_*` live in OpenBao + GitHub Secrets; fingerprint-verified as the original upload
key. The `bw`/Vaultwarden flow is fully retired.

### C. Google Play (one-time)

1. Play Console ($25 one-time): **Create app**, package `dev.fressh.app`; accept Play App Signing
   (our keystore is the upload key).
2. **Manually upload the first .aab** (Play API limitation): use the §A release artifact →
   Testing → Internal testing → Create release; add your Gmail as tester.
3. Service account for the API: follow https://docs.fastlane.tools/actions/supply/#setup (create
   GCP service account + JSON key, invite it in Play Console with release permissions).
4. Store the key (verbatim JSON):
   ```bash
   gh secret set GOOGLE_SERVICE_ACCOUNT_KEY_JSON < service-account.json
   nix develop -c secretspec set -f apps/mobile/secretspec.toml --provider bao --profile production GOOGLE_SERVICE_ACCOUNT_KEY_JSON
   ```
5. Test (needs a NEW versionCode vs the manual upload — cut a release first, or test on the next
   one): `nix develop -c secretspec run -f apps/mobile/secretspec.toml --profile production -- bun run --cwd apps/mobile submit:android`
6. For §E's prod promotion later: complete the store listing (description/screenshots/privacy/
   content rating) — the production track requires it. The listing text lives in
   `fastlane/metadata/android/en-US/` and is pushed by `supply` when you stop skipping metadata.

### D. Apple / iOS (one-time)

1. **ASC API key:** App Store Connect → Users and Access → Integrations → Team Keys → role
   **App Manager**; download the `.p8` (one chance). `gh secret set ASC_API_KEY_P8 < AuthKey_*.p8`
   + `secretspec set --provider bao`. Fill the **Key ID / Issuer ID / Team ID** constants in
   `fastlane/Fastfile` (`ASC_KEY_ID`/`ASC_ISSUER_ID`/`APPLE_TEAM_ID` — non-secret, committed).
2. **Register the bundle id** (one-time, if not already): developer.apple.com → Identifiers → **+**
   → App ID `dev.fressh.app`.
3. **Create the cert + profile:**
   `nix develop -c secretspec run -f apps/mobile/secretspec.toml --profile production -- bun run --cwd apps/mobile ios:certs`
   (fastlane `cert` generates the Apple Distribution cert + private key locally and saves a
   passwordless `.p12`; `sigh` creates the "fressh appstore" provisioning profile; both land in
   `apps/mobile/build/ios-signing/`).
4. **Store the signing material — the iOS twin of the Android keystore:**
   ```bash
   base64 -i build/ios-signing/<cert-id>.p12 | gh secret set FRESSH_IOS_CERT_P12_BASE64
   base64 -i build/ios-signing/appstore.mobileprovision | gh secret set FRESSH_IOS_PROFILE_BASE64
   # same two values via: nix develop -c secretspec set --provider bao --profile production ...
   ```
5. **ASC app record:** App Store Connect → My Apps → **+** → bundle `dev.fressh.app` (pilot/deliver
   need the record to exist).
6. **First iOS build (the expected-iteration step):**
   `nix develop -c secretspec run ... -- bunx turbo build:ios --filter @fressh/mobile` — debug the
   gym archive until green (scheme `Fressh`, workspace generated by prebuild; the build lane
   imports the cert into a temp keychain on CI and pins manual signing to the "fressh appstore"
   profile). Then a CI dispatch with `platform: ios`.
7. iOS listing text: `fastlane/metadata/en-US/` (deliver pushes it during `promote:ios`).

### ✅ DONE (2026-06-10): Google Play auth via Workload Identity Federation

No Google service-account key exists anywhere. GCP project `fressh-mobile-ssh`, SA
`fastlane-supply@…iam.gserviceaccount.com` (zero GCP roles — authorization is the Play Console
user invite), WIF pool `github` + provider `github-actions` bound to repository_owner
`EthanShoeDev`, impersonation granted to `…/attribute.repository/EthanShoeDev/fressh`. Workflows:
`id-token: write` + `google-github-actions/auth@v2` (provider
`projects/222063936101/locations/global/workloadIdentityPools/github/providers/github-actions`) →
exports `GOOGLE_APPLICATION_CREDENTIALS`, which the Fastfile's `play_auth_args` prefers
(`GOOGLE_SERVICE_ACCOUNT_KEY_JSON` from bao remains as a local-only fallback). WIF only works
inside Actions — local submits would need `gcloud auth application-default login` or the fallback.

### TODO (next): CI reads OpenBao directly — stop mirroring secrets into GitHub

Today every secret is stored twice (OpenBao for local, GitHub Secrets for CI) and the workflows
carry per-secret `env:` blocks. Proposed (user idea, 2026-06-10): CI authenticates to OpenBao and
resolves via secretspec's `bao` provider, so OpenBao becomes the single source of truth. secretspec
stores keys at **`secret/data/secretspec/fressh-mobile/production/<KEY>`** (`vault.rs`
`format_secret_path`), so the CI policy is one line:

```hcl
path "secret/data/secretspec/fressh-mobile/production/*" { capabilities = ["read"] }
```

Two rungs:
1. **Scoped static token:** `bao token create -policy=ci-fressh -orphan -period=768h` → single
   `VAULT_TOKEN` GitHub secret; workflows drop `--provider env://` and all per-secret env blocks.
   Still a long-lived credential to rotate.
2. **OIDC (preferred, zero static secrets):** enable OpenBao's `jwt` auth method against GitHub's
   OIDC issuer (`https://token.actions.githubusercontent.com`), role bound to
   `repository: EthanShoeDev/fressh` (+ ref binding for prod-only secrets later), mapped to the
   policy above. Workflow: `permissions: id-token: write`, exchange the job's OIDC token for a
   short-lived bao token (curl or vault-action), export `VAULT_TOKEN`, run secretspec. No GitHub
   secrets at all.

Notes: keep the GH-secret mirror until OIDC is proven (the `["env","bao"]` chain means env wins
when present — fallback for bao downtime); CI gains a hard dependency on `bao.ethanshoe.dev`
being up + reachable from GH runners; runtime-fetched values are not auto-masked in Action logs
(GH only masks registered secrets) — lanes never echo them, but don't add `set -x`.

### E. The repeatable flow (after C/D)

1. Flip `submit: false → true` and `platform: android → all` in `release.yml`'s build job.
2. **Beta:** merge feature PRs (each with a changeset) → merge the Version Packages PR → tag +
   GitHub Release + artifacts + **Play internal + TestFlight automatically**, release notes from
   the CHANGELOG.
3. **Prod:** Actions → **Ship Prod** → run with `version: 0.2.0` → same artifacts promoted to Play
   production + submitted for App Review (auto-release on approval). Optional later: staged
   rollout (`rollout:` in the promote lane), a GitHub Environment approval gate, or the
   Expensify-style checklist issue (see Release flow section).
4. **Hotfix:** see "Release flow" step 4 (branch off the shipped tag, cherry-pick, dispatch
   build-mobile against the branch, promote).

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

> **STATUS (rev 2026-06-10): OpenBao adopted (not keyring).** `apps/mobile/secretspec.toml` uses
> per-secret chains `["env", "bao"]` with `bao = "openbao://bao.ethanshoe.dev/secret"` (self-hosted
> OpenBao, KV v2 mount `secret`). **Local dev** resolves the chain → OpenBao; **CI** forces
> `--provider env://` (GitHub Secrets), since CI can't/shouldn't reach OpenBao. `EXPO_TOKEN` is stored
> in both (OpenBao for local, the `EXPO_TOKEN` GitHub secret for CI). Two gotchas found:
> (1) nixpkgs `secretspec` lagged at 0.3.3 with **no `openbao` backend** — the flake now pulls it from
> a `nixpkgs-recent` input (0.10.1, vault feature compiled in); (2) a per-machine
> `~/.config/secretspec/config.toml` must exist with a `[defaults] provider` set to a real backend/URI
> (an alias there fails); chain aliases themselves resolve from the project `[providers]` table.
> (OpenBao **auto-unseal is configured**, so the server stays available across restarts.)

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

## Future goal: preview & beta distribution (PR previews + beta builds)

**Status: DEFERRED** — desired, but implement only after the first production build path is green
(adding EAS Update / channels mid-bringup muddies build debugging). Captured here so the design is
on record.

### The core mental model: two delivery mechanisms

A native app ships a change one of two ways; which one a given change can use depends on whether it
touches native code:

| | **OTA update** (EAS Update or self-hosted) | **New build** (EAS Build or GH Actions) |
|---|---|---|
| Ships | JS bundle + assets | a native binary (APK/AAB/IPA) |
| Speed / cost | seconds, ~free | 10–35 min, costs build minutes |
| Can deliver | JS/asset changes only | anything (native deps, config plugins, SDK bumps) |
| Gated by | tester's installed binary `runtimeVersion` | — |

So **"PR preview" ≈ an OTA update** published to a per-PR branch, and **"beta" ≈ a build on a
staging channel / store testing track**. An OTA preview only loads if the tester's installed build
has a *compatible* runtime; native-touching PRs can't be OTA-previewed and need a fresh build.

### PR previews
- Testers install a dev or internal **preview** build once. CI runs `eas update --branch pr-<n>` per
  PR; the **Expo GitHub App** comments a QR code; JS-only changes load instantly in the dev client.
- Gate a real per-PR `eas build` behind a label (e.g. `needs-build`) for native-touching PRs, so we
  don't spend build minutes on every PR. A `fingerprint` runtime policy makes OTA *fail safe* when a
  PR changes native deps.

### Beta builds
- Expo's **persistent staging flow**: `staging` + `production` channels mapped to `eas.json`
  profiles; `expo-github-action` publishes an OTA update on merge to a staging branch; beta
  *binaries* go to **TestFlight** / **Play Internal testing** (internal testing = no Apple review,
  instant, up to 100 testers).
- Beta *versioning* can reuse changesets **snapshot/pre mode** (`changeset version --snapshot beta`
  → `0.0.5-beta-<sha>`), keeping the changelog flow intact.

### Prerequisites (none present today)
- **`expo-updates`** installed + configured — EAS Update is OFF today, so OTA previews aren't possible
  yet. This is the main lift.
- A **`runtimeVersion` policy** — recommend **`fingerprint`** (auto-invalidates OTA on native change).
- A **`channel`** per `eas.json` profile, the **Expo GitHub App** on the repo, and `EXPO_TOKEN`.

### The "drop EAS" spectrum (how this interacts with going EAS-independent)

"Switch off EAS" is really **three independent choices** — you can mix them:

1. **Build compute:** EAS cloud Build → **`eas build --local` on GH-hosted runners** (keeps the EAS
   CLI + managed credentials + `eas submit`; you pay GH Actions minutes, *not* EAS build credits —
   roughly Ubuntu ≈ \$0.28/Android build, macOS ≈ \$2.80/iOS build per the "Don't Pay for EAS" write-up)
   → full **Track B** (Fastlane, self-managed signing, no Expo account at all). `eas build --local`
   is exactly **Track A5** above and is also the fastest way to get *real* build logs locally while
   debugging (no cloud round-trip, no credits).
2. **Store submission:** `eas submit` (a **free** EAS service — worth keeping even with local builds)
   → Fastlane `deliver`/`supply`.
3. **OTA:** EAS Update (hosted) → **self-hosted `expo-updates` server** (EAS Update is
   build-pipeline-agnostic and runs fine without EAS Build — see
   `eas-update/standalone-service.mdx`; fits our self-hosting posture alongside Vaultwarden/OpenBao)
   → no OTA at all (then PR preview = per-PR builds only). **CodePush is not an option — Microsoft
   retired App Center / CodePush in 2025.**

The hard-to-replace piece is **OTA**, not build/submit. Cheapest "mostly off EAS" combo:
`eas build --local` on GH Actions + free `eas submit` + keep (or self-host) EAS Update.

---

## Open decisions (for the user)

1. **Track A vs B for v1.** Recommended: **Track A (EAS)** — least setup, free tier viable. Keep B
   documented as the escape hatch.
2. **EAS Workflows vs GH Actions calling `eas build`** (within Track A). Recommended: EAS Workflows
   (free, integrated). Either keeps changesets + release wiring in GH Actions.
3. **Reuse the Bitwarden keystore** (upload to EAS / feed to Fastlane) vs let EAS generate a new one.
   Recommended: reuse, to preserve the Play upload key.
6. **secretspec backend** — ✅ **RESOLVED: self-hosted OpenBao** (`bao.ethanshoe.dev`, `openbao://`
   provider), *not* keyring. Local dev reads the `["env","bao"]` chain → OpenBao; CI forces
   `--provider env://` (GitHub Secrets). See the STATUS note in the secretspec section above for the
   nixpkgs-version + global-config gotchas. (`bw` CLI / `bws` remain ruled out.)
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
