# Future project: automated screenshot pipeline — improvements

**Status:** PARTIALLY BUILT. The Maestro screenshot pipeline exists and works on iOS
(captures connect form + all four tabs); this doc records what's there, the sharp edges
hit while building it, and the improvements worth making — chiefly **seeding a real SSH
host** so the terminal / smart-terminal screenshots are actually representative. It's a
"what next + why" doc, not a committed plan.

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

**Where the creds come from → secretspec.** We're standardizing secret handling on
**[secretspec](https://secretspec.dev)** (see the secretspec section of
[ci-building-and-releasing.md](./ci-building-and-releasing.md) — same `env`/`keyring`,
future `vault://` provider chains). Add a `screenshots` profile to `secretspec.toml`
declaring the screenshot host secrets, and wrap the run so they arrive as env vars:

```toml
[profiles.screenshots]
SCREENSHOT_SSH_HOST     = { description = "screenshot demo host",     required = false, providers = ["env", "keyring"] }
SCREENSHOT_SSH_USER     = { description = "screenshot demo username",  required = false, providers = ["env", "keyring"] }
SCREENSHOT_SSH_PASSWORD = { description = "screenshot demo password",  required = false, providers = ["env", "keyring"] }
```

```bash
secretspec run --profile screenshots -- bun run --filter @fressh/mobile screenshots
```

`screenshots.ts` then reads `process.env.SCREENSHOT_SSH_*` and forwards them to Maestro via
`--env` (falling back to the rebex demo when unset, so the no-secret path still works). The
storage backend is secretspec's concern, not the script's — keyring locally, `env` (CI
secrets) in CI, OpenBao later — and the script never knows the difference.

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
  form from values the orchestration script forwards via `--env`, sourced from secretspec.
  The shipped app — and the screenshot build's *bundle* — have zero knowledge of them.

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
  dismisses the keyboard by tapping the non-interactive screen title instead.
- **Android is unvalidated.** The pipeline is written for both platforms but has only been
  run on the iOS simulator. Android `testID`s map differently (resource-id / content-desc),
  so the placeholder-selector workarounds may behave differently and want a pass.

## Phasing

1. **Real host for the terminal** (the headline win): parameterize the flow's connect step,
   read `SCREENSHOT_SSH_*` in the script (forward via Maestro `--env`), and source them from
   a secretspec `screenshots` profile. Unlocks the smart-terminal screenshots. Blocked on the
   secretspec rollout (see [ci-building-and-releasing.md](./ci-building-and-releasing.md)).
2. **Clean iOS selectors**: `accessible={false}` on `ConnectField` → drop the placeholder /
   point-tap hacks for `id:` selectors.
3. **Deterministic seed**: fire `CONNECTIONS` reactivity from the seed; capture Servers
   without depending on a connect.
4. **Android pass**: validate selectors + capture the `-android.png` set.
5. **CI**: run the pipeline in CI to keep screenshots fresh — folds into
   [ci-building-and-releasing.md](./ci-building-and-releasing.md). Note the iOS driver /
   port caveat and the secrets source in the CI environment.

## Pointers

- Flow: [`apps/mobile/test/e2e/screenshots.yml`](../../../apps/mobile/test/e2e/screenshots.yml)
- Orchestrator: [`apps/mobile/scripts/screenshots.ts`](../../../apps/mobile/scripts/screenshots.ts)
- Seed: [`apps/mobile/src/lib/screenshot-seed.ts`](../../../apps/mobile/src/lib/screenshot-seed.ts)
- Maestro source (vendored as docs): [`docs/cloned-repos-as-docs/Maestro`](../../cloned-repos-as-docs/Maestro)
