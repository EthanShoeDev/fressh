# Dev Builds (EAS)

This repo uses an Expo dev client for Android builds. Any change to native code
or generated UniFFI bindings requires a new EAS development build.

## When You Must Rebuild
- Rust or UniFFI changes in `packages/react-native-uniffi-russh`
- Native module changes that affect Android/iOS bridge code
- Anything that adds/removes native methods (JS expects a new native symbol)

## Standard EAS Dev Build Procedure (Android)
1) Sync workspace deps
```bash
pnpm install
```

2) If Rust/UniFFI changed, regenerate bindings locally
```bash
pnpm --filter @fressh/react-native-uniffi-russh build:android
```
Confirm the generated files are updated and tracked.

3) Build the dev client via EAS (cloud)
```bash
cd apps/mobile
eas build --platform android --profile development
```
If the build seems to ignore native changes, add `--clear-cache`.

4) Install the new APK
```bash
cd apps/mobile
eas build:run -p android --latest
```
Or download the APK from EAS and:
```bash
adb install -r path/to/app-dev.apk
```

5) Start Metro for dev client
```bash
cd apps/mobile
pnpm exec expo start --dev-client
```

6) Verify native changes are present
- Trigger the feature that uses the new native method.
- If the app logs “method … is undefined” or similar, the device still has an
  older dev client.

## Notes
- EAS builds use the current git state. Avoid local-only changes when building.
- Generated artifacts (UniFFI bindings) must be committed for EAS to see them.

## JS-Only Updates (EAS Update)
Use this when you only changed JS/TS (no native/Rust/UniFFI changes) and want
fast iteration without rebuilding.

### Prereqs (one-time)
- `expo-updates` is installed.
- Updates are enabled in `apps/mobile/app.config.ts`:
  - `updates.enabled: true`
  - `updates.url: https://u.expo.dev/<projectId>`
  - `runtimeVersion` is a **string** (bare workflow does not support policy).
- Install a fresh build once after enabling updates (EAS build + install).

### Publish a JS update
```bash
cd apps/mobile
pnpm exec eas update --branch <branch> --message "Describe change"
```

### Channel + branch mapping
The build profiles pin to channels in `eas.json`:
- `development` → `channel: development`
- `preview` → `channel: preview`
- `production` → `channel: production`

Publish updates to the matching branch (or update the channel to point at a
different branch):

```bash
# production builds
pnpm exec eas update --branch production --message "..."

# preview builds
pnpm exec eas update --branch preview --message "..."

# dev client builds
pnpm exec eas update --branch development --message "..."
```

### Default rule (dev mode)
When iterating locally or testing with dev clients, **only** publish to the
`development` branch unless you explicitly intend to update `preview` or
`production`.

## Build + Update Policy (Quick Reference)
Keep Git branches and EAS update branches separate: **Git branches are source
control**, EAS branches/channels are deployment targets.

Use this mapping to stay consistent:

- **Development (default for day-to-day work)**
  - Build: `pnpm exec eas build --profile development --platform android`
  - OTA: `pnpm exec eas update --branch development`
  - Use this unless you explicitly want preview/production.
- **Preview (QA/internal testing)**
  - Build: `pnpm exec eas build --profile preview --platform android`
  - OTA: `pnpm exec eas update --branch preview`
- **Production (release only)**
  - Build: `pnpm exec eas build --profile production --platform android`
  - OTA: `pnpm exec eas update --branch production`

**Rule:** during development, always use the **development** channel/branch
unless explicitly asked to use preview or production.

### Confirm updates are enabled on-device
```bash
adb shell cmd package dump com.finalapp.vibe2 | rg "expo.modules.updates"
```
Expected: `expo.modules.updates.ENABLED=true`.

## Common Gotchas
- Run `eas build` from `apps/mobile` for non-interactive builds. Running from
  repo root can fail with “android.package is required”.
- When `android/` exists, EAS uses native config from `android/` and ignores
  `android.package` in `app.config.ts`. This is expected.
- `runtimeVersion` **must** be a string in bare workflow builds.
