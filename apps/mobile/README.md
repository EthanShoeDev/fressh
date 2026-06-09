## Fressh Mobile (Expo)

The Fressh mobile app — a clean SSH client built with Expo / React Native and
expo-router. SSH, the VT engine, and the native renderer all come from the
single native package [`@fressh/react-native-terminal`](../../packages/react-native-terminal).

### Setup

```bash
bun install
bun run ios       # or: bun run android
```

Native builds require the platform toolchains (Xcode for iOS, Android SDK/NDK
for Android). The Nix devshell provides these — see the root
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

### Development notes

- The app has four tabs: **Servers**, **Commands**, **Keys**, **Settings**.
- Screens live under `src/app/` (expo-router file-based routing).
- Screenshots for the README/website are generated with `bun run screenshots`
  (see the root README's "Screenshots automation").

For a high-level feature overview, see the root [`README.md`](../../README.md).

### Links

- Main README: [`../../README.md`](../../README.md)
- Changelog: [`./CHANGELOG.md`](./CHANGELOG.md)
