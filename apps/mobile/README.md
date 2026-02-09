## Fressh Mobile (Expo)

This is the Fressh mobile app built with Expo. It provides a clean SSH client
experience. packages:

- `@fressh/react-native-uniffi-russh`
- `@fressh/react-native-xtermjs-webview`

### Setup

```bash
pnpm install
```

### Run (preview build, default)

Build and install a preview APK locally:

```bash
cd apps/mobile
pnpm exec eas build --local --profile preview --platform android
adb install -r path/to/app-preview.apk
```

Important signing rule for `com.finalapp.vibe2`:
- Keep one signing lane (EAS preview for normal dev).
- Do not mix APKs signed by different certs on the same package ID.
- Before uninstall/reinstall, export backup JSON from
  `Settings -> Backup & Restore` so private keys/connections can be restored.

For JS-only changes, publish an update to the preview channel:

```bash
cd apps/mobile
pnpm exec eas update --channel preview --message "Describe change"
```

Preview builds run standalone and do not require Expo Go or Metro for the
normal workflow. For the full workflow (native rebuilds, OTA policy), see
[`docs/dev-builds.md`](../../docs/dev-builds.md).

### Development notes

- Edit files under `app/` (file-based routing)
- Ensure Android tooling is installed for local builds

### Links

- Main README: [`../../README.md`](../../README.md)
- Changelog: [`./CHANGELOG.md`](./CHANGELOG.md)
