# Mobile Build, Install, And Update Runbook

This repo uses one default Android development workflow:

1. Build native/runtime changes as a **local EAS preview APK**.
2. Install that APK on-device with ADB.
3. Ship JS/assets-only changes with **EAS Update** on the `preview` channel.

Policy:

- Use `preview` profile for day-to-day work.
- Use local builds only (`eas build --local`).
- Do not use Metro/dev-client for normal development.
- Do not bypass EAS doctor by switching to a debug Gradle APK for
  `com.finalapp.vibe2`; fix the Expo dependency drift first.

## App + Channel Invariants

- Android package: `com.finalapp.vibe2`
- Preview build channel: `preview`
- OTA updates for preview builds must be published to channel `preview`

## Android Signing Lane (Must Follow)

To avoid `INSTALL_FAILED_UPDATE_INCOMPATIBLE` and accidental key loss, keep a
single signing lane for `com.finalapp.vibe2`.

- Use one signing source per package ID:
  - day-to-day: preview builds from EAS (`eas build --local --profile preview`)
  - release migration: release keystore flow in this file
- Do not install mixed-signature APKs for `com.finalapp.vibe2` (for example:
  local debug Gradle build on top of EAS preview install).
- If you need another signing lane, use a different package ID.
- Before any uninstall/reinstall that might happen during signature migration:
  create and export backup JSON from `Settings -> Backup & Restore`.

If mismatch still happens, only two recovery paths exist:

- Install an APK signed with the same certificate as the currently installed
  app.
- Or uninstall and reinstall (then restore backup JSON).

## App Data Safety

Private keys are stored in app-local secure storage. Any command that clears app
data deletes those keys unless a backup has been exported.

- Normal e2e runs must use `pnpm --filter @fressh/mobile test:e2e`; this
  preserves app data.
- Do not run `adb shell pm clear com.finalapp.vibe2` on a personal or shared
  device.
- The only allowed scripted app-data wipe is
  `pnpm --filter @fressh/mobile test:e2e:clear-state`, which requires the
  explicit private-key deletion confirmation baked into the script.

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

If unsure, rebuild the preview APK. OTA can update JavaScript and assets, but it
cannot update native libraries, Android manifest/config, Expo runtime version,
or bundled native modules.

## Canonical Native Build Procedure

Use this for native/runtime changes and for any change where OTA eligibility is
unclear.

1. Confirm the Android device is reachable.

```bash
adb devices -l
```

For wireless debugging, connect first:

```bash
adb connect <device-ip>:<adb-port>
adb devices -l
```

For USB-over-host ADB, point this shell at the host ADB server:

```bash
export ADB_SERVER_SOCKET=tcp:<host-tailscale-ip>:5037
adb devices -l
```

2. Verify Expo dependency compatibility before building.

```bash
cd apps/mobile
pnpm exec expo install --check
```

If this reports outdated SDK packages, fix them before building:

```bash
pnpm exec expo install --fix
pnpm exec expo install --check
```

Expected: `Dependencies are up to date`.

3. Build the local EAS preview APK.

```bash
cd apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android
```

Use `EAS_SKIP_AUTO_FINGERPRINT=1` for normal local iteration; fingerprinting is
useful for CI/release diagnostics but often adds time without changing the APK
result.

`ANDROID_HOME` and `ANDROID_SDK_ROOT` must point at the installed Android SDK.
On this development machine the SDK is `/home/muly/Android/Sdk`.

4. Install the APK on the target device.

```bash
adb -s <device-serial> install -r <path-to-generated-apk>
```

If only one device is connected, `-s <device-serial>` may be omitted. Keep it
when wireless and USB devices might both be visible.

5. Launch and verify the installed build.

```bash
PKG=com.finalapp.vibe2

adb -s <device-serial> shell am force-stop "$PKG"
adb -s <device-serial> shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
adb -s <device-serial> shell dumpsys package "$PKG" \
  | rg "versionName|versionCode|lastUpdateTime|signatures"
adb -s <device-serial> shell pidof "$PKG"
```

6. Capture a quick startup log check.

```bash
PID=$(adb -s <device-serial> shell pidof -s com.finalapp.vibe2 | tr -d '\r')
adb -s <device-serial> logcat -d --pid="$PID" -t 500 \
  | rg -i "fatal|exception|crash|Fressh App Init|ErrorRecovery"
```

Expected: `Fressh App Init` appears, and there are no fatal crash lines.

## Standard Preview Build Procedure (Local)

1. Sync workspace deps

```bash
pnpm install
```

2. If Rust/UniFFI changed, regenerate bindings

```bash
pnpm --filter @fressh/react-native-uniffi-russh build:android
```

3. Build preview APK locally

```bash
cd apps/mobile
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android
```

4. Install APK on device

```bash
adb install -r path/to/app-preview.apk
```

5. Launch app

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
  - verify `updates.requestHeaders["expo-channel-name"]` in
    `apps/mobile/app.config.ts`

- Native change not reflected:
  - OTA cannot deliver native/runtime changes
  - rebuild and reinstall local preview APK

- `expo doctor` or EAS local build fails on dependency versions:
  - do not switch to a debug Gradle APK as a shortcut
  - run `cd apps/mobile && pnpm exec expo install --check`
  - fix with `pnpm exec expo install --fix`
  - rerun `pnpm exec expo install --check`
  - retry the local EAS preview build

- EAS local build reaches Gradle and fails with `SDK location not found`:
  - export or inline `ANDROID_HOME=/home/muly/Android/Sdk`
  - export or inline `ANDROID_SDK_ROOT=/home/muly/Android/Sdk`
  - verify `ls "$ANDROID_HOME/platform-tools"` works
  - retry the local EAS preview build

- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` during install:
  - you switched signing lane for `com.finalapp.vibe2`
  - export backup JSON in app if possible
  - uninstall old app
  - install APK from the intended single lane
  - restore backup JSON in `Settings -> Backup & Restore`

## Release Keystore + Data-Preserving Migration

Use this when moving devices to a stable release keystore without losing data.

This is also the only acceptable Gradle fallback for `com.finalapp.vibe2`.
Fallback Gradle APKs must be signed with the same release/upload keystore lane
as the installed app. A debug-signed Gradle APK must not be installed over the
normal preview/release package unless you intentionally uninstall and restore
from backup.

### Keystore source (Bitwarden)

The Android release keystore is stored in Bitwarden under **"fressh keystore"**.

- `login.username` -> key alias
- `login.password` -> store/key password
- custom field `keystore` -> base64-encoded keystore file

### Build a release-signed APK locally

Ensure `bw` is logged in and `BW_SESSION` is set (for example,
`bw unlock --raw`). The release keystore is stored locally at
`apps/mobile/android/app/fressh-upload-key.keystore` and is gitignored. If the
file already exists, you can skip the Bitwarden fetch.

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

APK output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

Install and verify:

```bash
adb -s <device-serial> install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
adb -s <device-serial> shell monkey -p com.finalapp.vibe2 -c android.intent.category.LAUNCHER 1
adb -s <device-serial> shell dumpsys package com.finalapp.vibe2 \
  | rg "versionName|versionCode|lastUpdateTime|signatures"
```

To allow `adb shell run-as` during a one-time restore, build a debuggable
release:

```bash
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
  -PFRESSH_DEBUGGABLE_RELEASE=true
```

### Data-preserving migration (debug -> release keystore)

1. Create backup JSON on device.
2. Store backup securely.
3. If signatures do not match, uninstall old app:

```bash
adb uninstall com.finalapp.vibe2
```

4. Install debuggable release APK for restore:

```bash
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

5. Push backup via ADB and restore in app (preferred, works on non-debuggable
   builds):

```bash
adb push /path/to/backup.json /sdcard/Download/backup.json
```

In app: `Settings -> Backup & Restore -> Import from picked file` and select
`Downloads/backup.json`, then tap `Restore`.

Optional legacy method (requires a debuggable build because it uses `run-as`):

```bash
adb push /path/to/backup.json /data/local/tmp/backup.json
adb shell run-as com.finalapp.vibe2 cp /data/local/tmp/backup.json \
  /data/user/0/com.finalapp.vibe2/files/backup.json
```

6. Install final non-debuggable release APK (same keystore):

```bash
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Common Gotchas

- Run `eas build` from `apps/mobile` for non-interactive local builds.
- When `android/` exists, EAS uses native config from `android/` and ignores
  `android.package` in `app.config.ts`.
- `runtimeVersion` must remain a string in this bare-workflow setup.
