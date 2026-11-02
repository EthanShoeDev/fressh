# Future project: automated screenshot pipeline — improvements

**Status:** BUILT + VALIDATED ON ANDROID (2026-06-24) **AND iOS (2026-06-26)**. The
pipeline spins up a throwaway **docker sshd** itself, parameterizes the connect form, loops
**every theme**, captures a **live terminal** (real bash shell, smart-terminal context
bar), and **resizes / fans out** to README/website/fastlane — all typecheck + lint clean. A
full Android run produced **35 captures (5 themes × 7 screens, including live terminals)**;
the **2026-06-26 iOS run produced the matching 35** (`<screen>-<theme>-ios.png`), and the
derive step now emits **70 `small/` variants** and copies the 7-shot graphite store subset
into fastlane. See *iOS gotchas (2026-06-26)* for the traps that had to be cleared first —
they are non-obvious and will bite again. (One bit AFTER that "successful" run: every iOS
theme rendered identically because the theme switch silently no-op'd on iOS — see the
theme gotcha — so the first 35-shot iOS set had to be regenerated.)

This is a "what next + why" doc, not a committed plan.

## Implemented in this pass (2026-06-24)

All phases done and validated on the Android emulator (the worklets build blocker below
was fixed). This stays a local-only tool — no CI.

**`terminal-*` vs `smart-terminal-*` — were byte-identical, now distinct (2026-06-25).**
The old flow tried to differentiate the smart shot by swiping the keyboard toolbar to
page 2 and tapping the `git status` preset chip, but the swipe coordinate (`88%,86%` →
`12%,86%`) landed in the **system soft keyboard**, not the app's preset toolbar (which
sits at ~52–62% of screen height above the keyboard) — so paging never happened and the
two captures came out **md5-identical** (a bare prompt + context bar). Two more traps made
the old approach unworkable: (a) the **terminal body is a native GL surface** whose glyphs
are NOT in Maestro's accessibility tree, so you can't assert on terminal output — only on
RN text (context bar, sheets); and (b) the hidden `terminal-input` (1px, opacity-0) isn't
in the a11y tree either, so `tapOn id:terminal-input` fails — but it's **auto-focused on
mount** with the keyboard up, so `inputText` types straight into it without a tap.

The new flow (no fragile swipe, only robust selectors) makes the two genuinely different:
- **`terminal-*` ("a real SSH session"):** type a few real read-only commands into the
  auto-focused input (`git log --oneline`, `cat package.json`, `git status -sb` — ending
  on the clean, colorful branch+dirty output), then `hideKeyboard` for a **full-height
  terminal of real scrollback**. The key/nav accessory toolbar stays pinned at the bottom.
- **`smart-terminal-*` ("command status, timing & working dir"):** tap the always-visible
  context bar (`accessibilityLabel='Smart terminal details'`) to open the **details
  sheet** — the richest smart surface: working directory, the git section (branch +
  staged/unstaged/untracked + changed-file list), and recent commands with exit ✓ + timing.
  Those read-only commands above seed the recent-commands list; the git badge/section come
  from the out-of-band git driver (no in-shell `git status` needed).

Supporting changes: the temp sshd runs with `--hostname acme-api` (prompt reads
`demo@acme-api:~$`, not the random container id), the demo repo is left with a realistic
dirty tree (1 staged · 2 unstaged · 1 untracked), and the fastlane **store subset now
includes `terminal` + `smart-terminal`** (`screenshot-derive.ts`), in the website's
narrative order.

- **Phase 1 — temp docker sshd (done, code):** `scripts/screenshots.ts` builds a tiny
  ubuntu+bash+git sshd image (cached), runs it with a per-run password (no secrets),
  and forwards `SSH_HOST/PORT/USER/PASS` to Maestro (`10.0.2.2` for Android, `127.0.0.1`
  for iOS); torn down via an Effect `acquireRelease` scope. Plain `SCREENSHOT_SSH_*`
  env vars override it; rebex is the last-resort fallback.
  The flow submits the form, trusts the host (TOFU), and captures a **live bash shell**
  (`demo@<container>:~$`). Also fixed: the maestro binary is resolved from `PATH` (the old
  hard-coded `~/.maestro/bin` broke the nix install), and the Android build now passes
  `--no-bundler` like iOS. Host port is **2223, not 2222** — see *Android gotchas*.
- **Phase 2 — clean `id:` selectors (done):** `ConnectField`'s wrapper is
  `accessible={false}`, so each `TextInput` testID surfaces on iOS; the flow uses
  `id: host/port/username/password`. Theme cards got `testID="theme-<id>"`; the
  terminal's hidden input got `testID="terminal-input"`.
- **Phase 3 — deterministic seed (done):** the seed now
  `atomRegistry.refresh(connections.atoms.list)` after writing, so the Servers tab is
  populated without a live connect. (Note: `Reactivity.invalidate` is a *service method*
  and `appRuntime` doesn't carry that service — a direct `refresh` on the shared
  registry is the instance-safe fix.)
- **Phase 4 — all themes (done + validated):** `screenshots.ts` loops `--themes`
  (default all five). The app defaults to the **Native** theme, whose Settings hides the
  swatch grid behind an **Appearance** nav row, so the flow opens that and picks the theme
  by its native-row label (`THEME_LABEL`, passed by the script) — the inline-grid testID is
  a fallback. A flaky single-theme run is now logged and skipped (non-fatal) so one miss
  doesn't lose the whole pass + derive.
- **Phase 6 — resize + fan-out (done + validated):** `scripts/screenshot-derive.ts`
  resizes with **Bun's native image pipeline**
  (`Bun.file(src).image().resize(400).png().write(out)` — the snippet below) to emit
  width-400 `small/` variants, and uses the **effect `FileSystem` service** (no
  `node:fs`) to copy a graphite store subset into fastlane (numbered `1.png`…). Bun's
  image API needs **bun ≥ 1.3.14**; nixpkgs is held at 1.3.13 (the 1.3.14 bump is
  stuck in draft — `bun build --compile` segfaults on Nix,
  [nixpkgs#519796](https://github.com/NixOS/nixpkgs/pull/519796) /
  [bun#31023](https://github.com/oven-sh/bun/issues/31023) — which doesn't affect our
  interpreted scripts), so `flake.nix` overlays
  bun's prebuilt sources to the official 1.3.14 release (and `package.json` pins
  `bun@1.3.14`). The website `screenshotManifest` builds itself from a Vite
  `import.meta.glob` over the captures, so new themes/platforms slot in with no code
  change. Both validated (web build emits the assets; derive resizes the shots).
- Legacy `<screen>-ios.png` captures were renamed to the new
  `<screen>-graphite-ios.png` convention.
- **Toolchain cleanup (2026-06-24):** the scripts no longer redeclare the theme list —
  it lives once in `src/lib/app-themes.ts`, a dependency-free module the RN app
  (`theme.tsx`, `preferences.tsx`) and the bun-run scripts both import. `screenshots.ts`
  reads its `SCREENSHOT_SSH_*` / `HOME` env through effect `Config` (default `fromEnv`
  provider) rather than `process.env`, and all derive file I/O goes through the effect
  `FileSystem` service.

## Android gotchas (found + fixed during the live run)

These bit hard on the first real Android run; the fixes are in `screenshots.ts` /
`screenshots.yml` / the Dockerfile, but they're worth knowing:

- **Host port 2222 collides with Windows OpenSSH (WSL2).** On a Windows/WSL2 box the
  emulator's `10.0.2.2` routes to the *Windows* host, where OpenSSH-for-Windows often
  listens on 2222 — so the app connected to *that* sshd (right port, wrong server: a
  different host key, and auth fails because there's no `demo` user). The temp sshd now
  uses **2223**. Symptom: host-key prompt shows an unexpected fingerprint, then "auth
  failed", and the container's `docker logs` show **zero** connections.
- **sshd `UsePAM no` rejects password auth on Ubuntu 24.04.** The container must use PAM
  (the default) for `chpasswd`-set passwords to validate; `UsePAM no` silently rejects
  every password. (Standalone `ssh`/`sshpass` hits the same wall — it's the container,
  not the client.)
- **Google Password Manager "Save password?" dialog covers the tab bar.** Filling the
  connect form's password makes Android queue a save-prompt that pops on a *later* launch
  and blocks the first tab tap. The script now runs
  `adb shell settings put secure autofill_service null` before capturing.
- **Maestro `hideKeyboard` == Android Back when no keyboard is up** → it dismisses the
  host-key modal. Only hideKeyboard while a keyboard is actually open.
- **Maestro 2.0.3: a flow `env:` block OVERRIDES `--env`** (reverse of the docs). The flow
  has no `env:` block; the script supplies everything via `--env`.
- **Themed `Button` / modal content isn't matchable by title text** (the Button groups its
  subtree, and RN `Modal` text-but-not-testID surfaces oddly) — give buttons a `testID`
  (`host-key-trust`, etc.) and tap by `id:`.

## iOS gotchas (2026-06-26 — first successful iOS run)

The first real iOS run hit four independent, non-obvious blockers. None is the iOS-driver
port 5600 thing the old notes warned about (Maestro 2.6.0's XCUITest driver uses **22087**,
not 5600). In order:

- **Maestro iOS needs the GUI (Aqua) login session — it hangs silently over SSH.** Run from
  an SSH / VS Code-Remote / Cursor-Remote shell (`launchctl managername` → `Background`),
  `xcodebuild test` for the driver never starts; Maestro freezes right after
  `… Using SLF4J …` with no further log and no driver port. Run it from a Terminal.app/iTerm
  on the Mac's **physical desktop** (`launchctl managername` → `Aqua`). You can drive it from
  an SSH session via `osascript -e 'tell application "Terminal" to do script "…"'` (Terminal
  inherits Aqua); `launchctl asuser <uid> …` needs root.
- **dadb (Maestro's Android discovery) hangs on ActivityWatch's port 5600 — THIS is the real
  5600 trap.** Even with an explicit iOS `--device`, `TestCommand.getDeviceCount` →
  `DeviceService.listAndroidDevices` → `dadb.Dadb.list()` probes the emulator ADB port range
  (~5554–5682). **5600 is in that range**, and ActivityWatch's `aw-server` listens there,
  accepts the TCP connect, and never speaks ADB back → infinite blocking socket read (same
  `… Using SLF4J …` freeze). Confirm with `lsof -nP -a -p <maestro-pid> -iTCP` showing
  `→127.0.0.1:5600`. Fix: free 5600 (quit ActivityWatch) for the run, or move aw-server above
  ~5682. The `--driver-host-port 22087` pin in `screenshots.ts` does NOT help this — wrong
  port.
- **Docker can't pull images over SSH: `credsStore: "desktop"` needs the GUI keychain.** From
  a `Background` session the docker sshd build dies on `error getting credentials … keychain
  cannot be accessed because the current session does not allow user interaction` — even for a
  *public* base image, because the cred helper runs for every registry op. Running in the Aqua
  session fixes it (keychain reachable). Headless workaround: temporarily drop `credsStore`
  from `~/.docker/config.json` (public pulls need no auth), then restore.
- **The worklets `FETCH_PREVIEW_ENABLED` crash recurs on iOS because `ios/` is gitignored
  (CNG).** Same crash as the Android blocker below
  (`WorkletsError: [Worklets] Failed to initialize runtime`), but the Android fix
  (`package.json` → `FETCH_PREVIEW_ENABLED: false`) only reaches iOS when the Pods are
  regenerated — and `apps/mobile/ios/` is generated locally, never committed. A Mac whose
  Pods predate the flag flip still bakes `FETCH_PREVIEW_ENABLED:true` into
  `ios/Pods/Target Support Files/RNWorklets/RNWorklets.release.xcconfig` (worklets reads
  `worklets.staticFeatureFlags` from package.json at **pod-install** time —
  `node_modules/react-native-worklets/scripts/worklets_utils.rb`). Fix: `cd ios && pod
  install` (flips the xcconfig to `false`) then a **Release rebuild** so the worklets pod
  recompiles — `--skip-build` reinstalls the old crashing binary. Verify the flag with
  `grep FETCH_PREVIEW_ENABLED ios/Pods/Target\ Support\ Files/RNWorklets/RNWorklets.release.xcconfig`.

- **iOS terminal typed each printable twice under Maestro → fixed at the source.** The
  terminal's hidden capture input (`testID=terminal-input`) is a `multiline` `TextInput` held
  at `value=''`; on iOS that fires `onChangeText` TWICE per keystroke. The old
  `changeGuardRef` dropped the same-event-loop-turn duplicate, but **Maestro's `inputText`
  splits the two fires across turns**, so the duplicate leaked (typed `git` → `giit`,
  `command not found`, red `✗127` in the terminal/smart shots). A content/timing de-dup can't
  help — a real `--` is indistinguishable from a doubled `-`. Fixed by sourcing printables
  per platform in `terminal.tsx`: **iOS takes printables from `onKeyPress`** (fires once per
  key), Android keeps `onChangeText` (its soft keyboard doesn't emit `onKeyPress` for
  printables). `multiline` stays — it's what makes Android emit `onKeyPress` for
  Enter/Backspace. Also added a **Hide keyboard** button to the terminal toolbar
  (`testID=terminal-hide-keyboard`, calls `KeyboardController.dismiss()`): the flow taps it
  for the full-height terminal shot because Maestro's `hideKeyboard` can't act on the custom
  input on iOS (it aborted the flow before the `terminal`/`smart-terminal` shots).

- **Every iOS screenshot rendered the SAME theme — the theme switch silently no-op'd on iOS
  (found 2026-06-26, after the first "successful" iOS run).** The build defaults to the
  **Native** theme, whose Settings root puts theme selection behind an *Appearance* sub-screen
  built from `@expo/ui` **SwiftUI rows** (`NativeSelectRow` — a SwiftUI `Row onPress` with no
  `testID`). Maestro's iOS XCUITest driver can't reliably tap a SwiftUI row by its text, and
  the flow's theme taps were `optional: true`, so the first switch *from Native* silently
  failed and all five iOS runs stayed on Native — 35 shots, exit 0, but every stylized theme
  identical (the file sizes were a tell: phosphor/graphite/aurora/monolith within a few KB of
  each other, Native distinct). Android was fine — its Compose `ListItem` *is* tappable, which
  is why it shipped unnoticed. **Fix:** boot the screenshot build on a *stylized* theme instead
  of Native (`initAppTheme` forces `phosphor` when `EXPO_PUBLIC_SCREENSHOT_SEED=1`). Only the
  stylized Settings *root* shows the swatch grid inline, where every theme — Native included —
  is a real RN `Pressable` with a queryable `theme-<id>` testID. The flow then needs just one
  grid tap, and it's **no longer `optional`**: a missed theme tap must FAIL the run loudly
  rather than emit duplicate-theme screenshots. Lesson: `optional: true` on a step whose whole
  purpose is to change state hides exactly this class of silent regression.

  **Follow-on it exposed:** once the themes actually switched, the stylized runs started
  aborting at the connect form's `- hideKeyboard` — *"Couldn't hide the keyboard … the app
  uses a custom input"* (the stylized themes' custom RN `TextInput`s have no standard iOS
  dismiss action). The script tolerates a per-theme flow failure (`⚠️ capture failed
  (continuing)`), so it silently skipped the connect/terminal/smart-terminal shots for all
  four stylized themes, leaving them stale. It had been masked because every run was wrongly
  stuck on the Native theme, whose `@expo/ui` inputs *do* expose a dismiss. Fix: `hideKeyboard`
  is now **Android-only** (`runFlow: { when: { platform: Android } }`); on iOS the existing
  `tapOn: 'New server'` title tap dismisses the keyboard instead — Maestro's own recommended
  substitute (tap a non-interactive element). Meta-lesson: a tolerated/`optional` capture
  failure is the same silent-success trap one layer up — the run is green but shots are stale.

## Discovered blocker (FIXED) — worklets Bundle Mode in the Android release bundle

The app uses **react-native-worklets ~0.8.3 Bundle Mode** (for `react-native-effects`'
off-thread render loop; wired in `apps/mobile/metro.config.js`, `babel.config.cjs`
`bundleMode:true`, and `package.json` `worklets.staticFeatureFlags`). The screenshot
pipeline needs a **Release** build (a dev-client `clearState` drops to the Expo
launcher). The first-ever Android Release build (this doc long noted "Android is
unvalidated") **crashes on launch**:

```
WorkletsError: [Worklets] Failed to initialize runtime. Reason: undefined is not a function
  at mockTurboModuleRegistry (index.android.bundle)  →  init  →  metroRequire
```

Root cause: the worklet-runtime initializer (`react-native-worklets/src/bundleMode/
metroOverrides.native.ts:89` `mockTurboModuleRegistry`) calls the metro **dev-runtime**
API `require.getModules()`, which doesn't exist in a minified **production** embedded
bundle. Crucially that call is gated by the **`FETCH_PREVIEW_ENABLED` static feature
flag** (resolved *natively* at build time from `package.json`), **not** by `__DEV__` —
so it fires in release. `apps/mobile/package.json` had set it to `true` (copied from
`react-native-effects`'s README), which is what opened the crashing path.

**Fix applied (2026-06-24), two parts, both store-safe:**
1. `apps/mobile/package.json` → `worklets.staticFeatureFlags.FETCH_PREVIEW_ENABLED:
   false` (the upstream default; also dropped the inert non-flag `BUNDLE_MODE_ENABLED`).
   `react-native-effects` never does networking on the worklet runtime, so this has no
   downside for production. The flag is baked into the native module, so it needs a
   native rebuild — fine, the store build (`scripts/signed-build.ts`) already does
   `prebuild:clean` + gradle.
2. `app.config.ts` → `expo-build-properties` `packagingOptions.pickFirst:
   ['**/libworklets.so']`. The first clean release build then failed at
   `mergeReleaseNativeLibs` because both `expo-modules-core` and `react-native-worklets`
   ship `libworklets.so`; they're the same build, so pick the first.

## Direction (decided 2026-06-11, not yet implemented)

The end state we want — superseding parts of the original plan below where they
conflict:

1. **Fully automated, zero manual setup.** The orchestration script should spin up
   **temporary SSH servers itself** before running the Maestro flows — using the
   effect-ts `Command` executor (`CommandUtils` in `packages/shared/src/cli-utils.ts`)
   to shell out to **docker** (or similar: `docker run -d -p 2222:22 <sshd image>`,
   podman, or a tiny embedded sshd). Throwaway credentials are generated per run, so
   the default path needs **no secrets at all** — the external-host override below
   becomes optional, not the prerequisite. The containers get torn down
   after the run. (Networking note: the iOS simulator can reach the host's
   `localhost` directly; the Android emulator reaches the host via `10.0.2.2`.)
   A real local sshd with bash also unlocks the smart-terminal (OSC 633) shots that
   test.rebex.net can't provide.
2. **Capture every theme — ideally all of them.** The flow should iterate the app's
   themes (currently `phosphor`, `graphite`, `aurora`, `monolith`, `native` — see
   `APP_THEMES` in `apps/mobile/src/lib/theme.tsx`) by switching the theme in
   Settings between capture passes, on **both platforms**. Output naming extends to
   `<screen>-<theme>-<platform>.png`.
3. **One pipeline feeds every surface.** The captured set is the single source for:
   - the **README** (a small subset, displayed small),
   - the **website** — `apps/web/src/routes/index.tsx` already has a
     `screenshotManifest` keyed by theme × platform driving theme/platform switcher
     components; new captures slot into it (eventually the script could generate the
     manifest),
   - **fastlane store pages** (`apps/mobile/fastlane/`) — the stores only want a
     handful, so the script (or a config list) **selects a subset** to copy into
     fastlane's screenshots dirs.
4. **Resize as part of the script.** The raw captures are far too big for the README
   (and heavier than the website needs). Add a resize/derivative step using **Bun's
   built-in image API** (<https://bun.com/docs/runtime/image>) — e.g.
   `await Bun.file(src).image().resize(400, 400, { fit: 'inside' }).png().write(out)`
   — emitting small variants for README/website alongside the full-size originals
   for the stores. No sharp/imagemagick dependency needed.

**Scope (if pursued):** `apps/mobile` only — the Maestro flow
([`test/e2e/screenshots.yml`](../../../apps/mobile/test/e2e/screenshots.yml)), the
orchestration script
([`scripts/screenshots.ts`](../../../apps/mobile/scripts/screenshots.ts)), and the
build-time seed ([`src/lib/screenshot-seed.ts`](../../../apps/mobile/src/lib/screenshot-seed.ts)).
Consumes the app as-is; the only app-code change contemplated is a small accessibility
tweak to the connect form (below).

## What exists today

`bun run --filter @fressh/mobile screenshots` (effect-ts CLI: `effect/unstable/cli` +
`effect/unstable/process` + `@effect/platform-bun`) drives the whole pipeline per
platform:

1. **Builds a Release variant** with `EXPO_PUBLIC_SCREENSHOT_SEED=1`. Release, not debug,
   because a dev-client `clearState` wipes the saved Metro URL and drops to the Expo
   launcher ("No development servers found") — an automated flow can't get past it. A
   Release build embeds the JS bundle (and the inlined seed flag), so it launches
   standalone.
2. **Resets the iOS simulator keychain** (`xcrun simctl keychain <udid> reset`) so only
   the seeded demo data shows — not whatever real hosts you've connected to on that sim.
3. **Runs the Maestro flow**, which navigates the app and writes one PNG per screen into
   `packages/assets/mobile-screenshots/<screen>-<platform>.png` (Maestro interpolates
   `${OUTPUT}`/`${PLATFORM}` from `--env` and appends `.png`).

The build-time seed pre-populates the **Servers** list (3 fake demo hosts) and the
**Commands** list (3 presets) so those tabs look populated. It's gated by
`EXPO_PUBLIC_SCREENSHOT_SEED` and is dead code in shipped builds.

## The core gap: the terminal screenshots aren't real

The seeded demo servers are **fake** — plausible labels, no working credentials — so they
can't connect. The flow therefore connects to **test.rebex.net** (a public SSH demo) for
the terminal shot, and that has two problems:

- Its shell **closes almost immediately** (the connection drops to `idle`), so the app
  bounces back to the Servers list before the terminal can be captured cleanly. The flow
  currently works around this by reattaching the `idle` connection, but it's fragile.
- It exposes **no real interactive shell**, so the **smart-terminal** features
  (OSC 633 shell integration — command status, timing, cwd tracking; see
  [smart-terminal-surface.md](../smart-terminal-surface.md) and
  [terminal-semantic-events.md](../complete/terminal-semantic-events.md)) never light up.
  Those are some of the most compelling things to screenshot, and we currently *can't*.

### Proposed fix: inject a real host at connect-time (not into the bundle)

> **2026-06-11:** the default host should now be a **docker-spawned temp sshd**
> started by the script itself (see *Direction* above) — throwaway creds, no secrets.
> Pointing the flow at an external host is just an optional `SCREENSHOT_SSH_*` env-var
> override (see below).

Connect the flow to a real host with a normal bash/zsh shell and "Smart terminal" on.
The credentials handling is the design crux:

- **Do NOT use `EXPO_PUBLIC_*` for real credentials.** Those vars are inlined into the
  JS bundle at build time, so a password there is permanently embedded in the build
  artifact. The fake seed is fine to inline; real secrets are not.
- **Pass the host to Maestro, and let the *flow* type it into the connect form.**
  Parameterize the connect step: `inputText: ${SSH_HOST}` / `${SSH_USER}` / `${SSH_PASS}`,
  defaulting to `test.rebex.net`/`demo`/`password` when unset. The orchestration script
  reads the creds from *its* environment and forwards them with `--env`. Credentials then
  live only in the runtime env + Maestro process — never in git, never in the app bundle.

**Where the creds come from → plain env vars (no secretspec).** The default path needs
**no creds at all** (the temp docker sshd generates a per-run password in memory), so the
override is deliberately lightweight: `screenshots.ts` reads `process.env.SCREENSHOT_SSH_HOST/
PORT/USER/PASSWORD` directly and forwards them to Maestro via `--env`, falling back to the
rebex demo when unset.

```bash
SCREENSHOT_SSH_HOST=demo.example.com SCREENSHOT_SSH_USER=demo SCREENSHOT_SSH_PASSWORD=… \
  bun run --filter @fressh/mobile screenshots
```

These are **demo creds, not secrets** — for a throwaway/public host you can commit them or
export them however you like. (An earlier draft proposed a secretspec `screenshots` profile;
that was dropped as over-engineered — only reach for a secret store if a particular host's
password is genuinely sensitive, in which case any env-var source, including secretspec,
works since the script only reads `process.env`.)

**Open decision — auth method:** password is simplest for the flow to type; an **SSH key**
is more secure *and* would let us screenshot the Keys → connect-with-key path, but the
flow then has to import/select the key (more steps). A throwaway VPS with a password is
the pragmatic v1; a key is the nicer end state.

If we want the **Servers list** to also show real, reattachable sessions (for a
scrollback/reattach screenshot), the same host(s) could be seeded as a *list* — but keep
the credential injection at the flow/Maestro layer, not in the bundle.

## Keeping the screenshot seed out of the shipped app

The guiding principle: **the internal screenshot build gets seeded; the app everyone else
installs does not.** That splits cleanly into two tiers by sensitivity, and *neither* tier
ships active to real users:

- **Tier 1 — non-secret demo data** (the fake Servers/Commands entries that make the list
  tabs look populated). This is allowed to live in the JS bundle because it carries **no
  secrets**, but it's gated behind `EXPO_PUBLIC_SCREENSHOT_SEED`. Expo inlines that var at
  build time, so in a normal build the gate is a literal `'1' === undefined` → **statically
  `false`**, and Metro/Hermes dead-code-elimination drops the branch. The screenshot build
  sets the flag; the shipped build doesn't, so the seed is effectively absent (and harmless
  even if a minifier left it). This is what's already implemented in
  [`screenshot-seed.ts`](../../../apps/mobile/src/lib/screenshot-seed.ts).
- **Tier 2 — real secrets** (SSH host + credentials for the *live* terminal / smart-terminal
  shots). These are **never in the app or the bundle at all** — not even dead-code-gated.
  They're injected at **runtime by the test harness**: Maestro types them into the connect
  form from values the orchestration script forwards via `--env`, sourced from plain
  `SCREENSHOT_SSH_*` env vars. The shipped app — and the screenshot build's *bundle* — have
  zero knowledge of them.

So "seed the internal app just for the screenshots test, not for everyone else" = **build-flag
gating for the harmless demo data, runtime injection for anything secret.** The thing to avoid
is the easy-but-wrong shortcut of putting real hosts/passwords behind the same
`EXPO_PUBLIC_SCREENSHOT_SEED` seed — that would bake secrets into the build artifact.

> If we ever want belt-and-suspenders removal of even the *non-secret* Tier-1 code from
> production bundles, a build-time transform (babel plugin eliding the module when the flag is
> unset) would do it — but it's optional, since Tier 1 is secret-free and already
> dead-code-eliminated when the flag is statically false.

## Other sharp edges worth fixing

- **FlashList rows are invisible to Maestro on iOS.** The Servers and Commands lists use
  `@shopify/flash-list`; its virtualized rows are *drawn* but are **not reliably present in
  Maestro's queryable accessibility hierarchy**. So `assertVisible`/`tapOn` on a list row
  (e.g. a server name) fails even though it's plainly on screen — which is why the flow
  can't tap a server to reattach its shell, and why it settles with a timed wait and
  screenshots the (correct) pixels instead of asserting on row text. This is the other half
  of why the live-terminal shot is hard: even with a real host seeded, *opening* it from the
  list needs a row tap Maestro can't currently do. Options to investigate: a non-virtualized
  list in screenshot builds, an `accessibilityIdentifier` on rows that survives virtualization,
  or Maestro's index/point selectors.
- **iOS form fields can't be matched by `testID`.** RN `testID` on a `TextInput` does
  *not* surface as an accessibility id on iOS when the input is wrapped in an `accessible`
  `Pressable` (which `ConnectField` does) — the wrapper groups the subtree and swallows
  the inner identifier. The flow works around it by tapping fields via **placeholder
  text** (`example.com`, `root`) and the **secure password field by screen position**
  (fragile). **Fix:** set `accessible={false}` on `ConnectField`'s wrapping `Pressable`
  (or move the `testID` onto it) so each field's `testID` surfaces — then the flow can use
  clean, cross-platform `id:` selectors (`host`/`username`/`password`) everywhere. Button
  `testID`s already surface (`id: connect` works), so this is isolated to the inputs.
- **Seed reactivity race.** The seed writes connections to the keychain, but the
  saved-servers list is an effect-atom query that only refreshes on a `CONNECTIONS`
  reactivity event — so seeded servers don't appear until *something* fires it. The flow
  sidesteps this by connecting first (a successful connect fires the event). **Fix:** have
  the seed fire the refresh itself (e.g. `useAtomRefresh(secretsManager.connections.atoms.list)`
  after writing), so the Servers tab shows seeded data deterministically without needing a
  connect — which would also let the flow capture Servers before the (flaky) terminal step.
- **Maestro iOS driver vs port 5600.** Maestro's iOS driver wants port **5600**;
  **ActivityWatch** (`aw-server`) defaults to the same port, and the collision makes the
  driver **hang silently at startup** (no error, no log past "Using SLF4J"). The script
  now prints a pre-flight warning if 5600 is occupied, but it can't auto-resolve it — free
  the port (quit ActivityWatch) if a run stalls at startup. Worth a note in CONTRIBUTING.
- **`hideKeyboard` is unsupported** by the app's custom keyboard handling on iOS; the flow
  dismisses the keyboard by tapping the non-interactive screen title instead — and even then
  iOS may keep a Passwords-AutoFill accessory up. Because an open keyboard **covers the bottom
  tab bar**, any tab navigation *after* the connect form silently taps nothing. The flow works
  around this by ordering **tabs first, the keyboard-opening connect form last**. A real fix
  would make the form reliably dismissable (or disable iOS password AutoFill in the screenshot
  build).
- **Android is unvalidated.** The pipeline is written for both platforms but has only been
  run on the iOS simulator. Android `testID`s map differently (resource-id / content-desc),
  so the placeholder-selector workarounds may behave differently and want a pass.

## Phasing

1. **Temp SSH server, fully automated** (the headline win): the script spins up a
   docker sshd via the effect-ts `Command` executor before the Maestro flows,
   parameterizes the flow's connect step with the container's throwaway creds, and
   tears it down after. `SCREENSHOT_SSH_*` env vars remain as an optional override for
   an external host. Unlocks the smart-terminal screenshots with zero manual setup.
2. **Clean iOS selectors**: `accessible={false}` on `ConnectField` → drop the placeholder /
   point-tap hacks for `id:` selectors.
3. **Deterministic seed**: fire `CONNECTIONS` reactivity from the seed; capture Servers
   without depending on a connect.
4. **All themes**: loop the capture pass per theme (switch in Settings), emit
   `<screen>-<theme>-<platform>.png`.
5. **Android pass**: validate selectors + capture the `-android` sets.
6. **Resize + fan-out**: native `Bun.Image` resize step (bun ≥ 1.3.14) for README/website
   variants; select and copy the store subset into `apps/mobile/fastlane/` screenshots
   dirs; feed the website's `screenshotManifest`.

**Not in CI — local-only.** This is a developer tool run on demand (`bun run
screenshots`) when the UI changes; it is deliberately not wired into CI.

## Pointers

- Flow: [`apps/mobile/test/e2e/screenshots.yml`](../../../apps/mobile/test/e2e/screenshots.yml)
- Orchestrator: [`apps/mobile/scripts/screenshots.ts`](../../../apps/mobile/scripts/screenshots.ts)
- Seed: [`apps/mobile/src/lib/screenshot-seed.ts`](../../../apps/mobile/src/lib/screenshot-seed.ts)
- Maestro source (vendored as docs): [`docs/cloned-repos-as-docs/Maestro`](../../cloned-repos-as-docs/Maestro)
