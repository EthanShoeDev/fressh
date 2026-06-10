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
pnpm run android
```

### Releasing

Versioning and changelogs are managed by [changesets](https://github.com/changesets/changesets).
In any PR that should show up in the release notes, add a changeset:

```
bun run changeset
```

Pick the affected package(s) + bump and write the note; commit the generated
`.changeset/*.md` file with your PR. When changesets land on `main`, the **Release**
workflow opens a "Version Packages" PR — merging it bumps the version, rewrites
`CHANGELOG.md`, and tags the release. See `.changeset/README.md` and
`docs/projects/ci-building-and-releasing.md` for details.

### CI

Pull requests run the workflow in `.github/workflows/check.yml`. Please ensure
lint/typecheck/tests pass.
