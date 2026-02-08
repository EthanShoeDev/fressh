# Preview Builds (Local, Android)

This repo uses a single default mobile workflow:

1. Build a **local preview APK**.
2. Install it on-device.
3. Ship JS/assets via **preview OTA updates**.

Policy:
- Use `preview` profile for day-to-day work.
- Use local builds only (`eas build --local`).
- Do not use Metro/dev-client for normal development.

## App + Channel Invariants

- Android package: `com.finalapp.vibe2`
- Preview build channel: `preview`
- OTA updates for preview builds must be published to channel `preview`

## Decide: OTA vs Rebuild

Publish OTA (`eas update`) when all changes are JS/assets only, including:
- `apps/mobile/src/**`
- generated JS in `apps/mobile/src/generated/**`
- styles, routes, and React component logic

Rebuild preview APK when any native/runtime surface changes, including:
- `packages/react-native-uniffi-russh/**` (Rust/UniFFI/native bridge)
- `apps/mobile/android/**` or native build config
- native module additions/removals
- `apps/mobile/app.config.ts` changes that affect updates/runtime behavior
- dependency changes that add/remove native code

## Standard Preview Build Procedure (Local)

1) Sync workspace deps
```bash
pnpm install
```

2) If Rust/UniFFI changed, regenerate bindings
```bash
pnpm --filter @fressh/react-native-uniffi-russh build:android
```

3) Build preview APK locally
```bash
cd apps/mobile
pnpm exec eas build --local --profile preview --platform android
```

4) Install APK on device
```bash
adb install -r path/to/app-preview.apk
```

5) Launch app
```bash
adb shell monkey -p com.finalapp.vibe2 -c android.intent.category.LAUNCHER 1
```

## JS-Only OTA Procedure (Preview)

Publish update:
```bash
cd apps/mobile
pnpm exec eas update --channel preview --message "Describe change"
```

Apply update on device (reliable cycle):
```bash
PKG=com.finalapp.vibe2

adb shell am force-stop "$PKG"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1

# Often needed so downloaded update is applied after restart
adb shell am force-stop "$PKG"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
```

## Verify The Update Running

In app: `Settings -> Updates`

Check:
- `Channel` is `preview`
- `Update ID` changed from previous value
- `Runtime` is unchanged for JS-only updates
- `Update time` reflects the new publish

## Fast Debug Commands

Check updates module enabled:
```bash
adb shell cmd package dump com.finalapp.vibe2 | rg "expo.modules.updates"
```
Expected: `expo.modules.updates.ENABLED=true`.

Stream logs for current app process:
```bash
while ! adb logcat --pid=$(adb shell pidof -s com.finalapp.vibe2); do sleep 1; done
```

## Troubleshooting OTA

- Update published but app unchanged:
  - verify publish used `--channel preview`
  - verify app shows channel `preview` in Settings
  - restart app twice (download then apply)

- App cannot download remote update:
  - reinstall a fresh local preview APK
  - verify `updates.requestHeaders["expo-channel-name"]` in `apps/mobile/app.config.ts`

- Native change not reflected:
  - OTA cannot deliver native/runtime changes
  - rebuild and reinstall local preview APK

## Release Keystore + Data-Preserving Migration

Use this when moving devices to a stable release keystore without losing data.

### Keystore source (Bitwarden)

The Android release keystore is stored in Bitwarden under **"fressh keystore"**.
- `login.username` -> key alias
- `login.password` -> store/key password
- custom field `keystore` -> base64-encoded keystore file

### Build a release-signed APK locally

Ensure `bw` is logged in and `BW_SESSION` is set (for example, `bw unlock --raw`).
The release keystore is stored locally at `apps/mobile/android/app/fressh-upload-key.keystore`
and is gitignored. If the file already exists, you can skip the Bitwarden fetch.

```bash
cd apps/mobile/android

item=$(bw get item "fressh keystore" --raw)
alias=$(printf '%s' "$item" | jq -r '.login.username')
pass=$(printf '%s' "$item" | jq -r '.login.password')
printf '%s' "$item" | jq -r '.fields[] | select(.name=="keystore").value' \
  | base64 -d > app/fressh-upload-key.keystore
chmod 600 app/fressh-upload-key.keystore

ORG_GRADLE_PROJECT_FRESSH_UPLOAD_STORE_FILE=fressh-upload-key.keystore \
ORG_GRADLE_PROJECT_FRESSH_UPLOAD_STORE_PASSWORD="$pass" \
ORG_GRADLE_PROJECT_FRESSH_UPLOAD_KEY_ALIAS="$alias" \
ORG_GRADLE_PROJECT_FRESSH_UPLOAD_KEY_PASSWORD="$pass" \
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

APK output:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

To allow `adb shell run-as` during a one-time restore, build a debuggable
release:

```bash
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
  -PFRESSH_DEBUGGABLE_RELEASE=true
```

### Data-preserving migration (debug -> release keystore)

1) Create backup JSON on device.
2) Store backup securely.
3) If signatures do not match, uninstall old app:
```bash
adb uninstall com.finalapp.vibe2
```
4) Install debuggable release APK for restore:
```bash
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```
5) Push backup via ADB and restore in app:
```bash
adb push /path/to/backup.json /data/local/tmp/backup.json
adb shell run-as com.finalapp.vibe2 cp /data/local/tmp/backup.json \
  /data/user/0/com.finalapp.vibe2/files/backup.json
```
6) Install final non-debuggable release APK (same keystore):
```bash
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Common Gotchas

- Run `eas build` from `apps/mobile` for non-interactive local builds.
- When `android/` exists, EAS uses native config from `android/` and ignores
  `android.package` in `app.config.ts`.
- `runtimeVersion` must remain a string in this bare-workflow setup.
