## Contributing

### Monorepo layout

- `apps/mobile`: Expo app (serves as the example for both packages)
- `apps/web`: Static site (Astro)
- `packages/react-native-uniffi-russh`: React Native native module exposing
  russh via UniFFI
- `packages/react-native-xtermjs-webview`: React Native WebView-based xterm.js
  renderer

### Prerequisites

- Node and pnpm installed
- Optional: Nix for dev shells (recommended)
- For native module work: Rust toolchain (rustup, cargo), Android/iOS build
  tools

With Nix:

```
nix develop .#default
```

Dev shell with android emulator included:

```
nix develop .#android-emulator
```

### Setup

1. Clone the repo
2. Install dependencies at the root:

```
pnpm install
```

3. Run the lint command:

```
pnpm exec turbo lint
```

### Develop

- Mobile app:

```
cd apps/mobile
pnpm exec eas build --local --profile preview --platform android
```

Install the APK and use preview OTA updates for JS-only changes:

```
cd apps/mobile
pnpm exec eas update --channel preview --message "Describe change"
```

This project defaults to preview-only local builds (no Metro/dev-client in the
normal flow). See `docs/dev-builds.md` for the full workflow and OTA vs rebuild
rules.

### Releasing

Each publishable package uses release-it. From the package directory:

```
pnpm run release
```

See the package CHANGELOGs for release notes:

- `packages/react-native-uniffi-russh/CHANGELOG.md`
- `packages/react-native-xtermjs-webview/CHANGELOG.md`

### CI

Pull requests run the workflow in `.github/workflows/check.yml`. Please ensure
lint/typecheck/tests pass.
