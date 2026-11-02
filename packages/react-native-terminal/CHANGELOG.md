# @fressh/react-native-terminal

## 0.2.0

### Minor Changes

- [`5b720aa`](https://github.com/EthanShoeDev/fressh/commit/5b720aa8f2fd3de849c209a7a0321b791dbe3455) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Support React Native 0.88 (Expo SDK 58). The Nitro view bindings are regenerated with nitrogen 0.37, so `react-native-nitro-modules` >= 0.37.0 is now required (raised from 0.35.0). Nitro 0.37 fixes the dangling view-props reference upstream, so the local nitrogen patch is gone. `TerminalRenderConfig`'s optional fields now also accept `undefined`, so they can be passed through under `exactOptionalPropertyTypes`.

## 0.1.1

### Patch Changes

- [#15](https://github.com/EthanShoeDev/fressh/pull/15) [`4e111d3`](https://github.com/EthanShoeDev/fressh/commit/4e111d303cebeb899ef7b7177121911198df8092) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Publish via npm OIDC trusted publishing with provenance. Stable (`latest`), prerelease (`rc`), and canary (`@canary` snapshot) lines are now cut from GitHub Actions with no long-lived npm token, and published tarballs carry a verified provenance attestation.
