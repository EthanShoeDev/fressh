## Fressh

[Fressh](https://fressh.dev/) is a mobile SSH client that remains clean and
simple while supporting powerful features.

[![ci](https://github.com/EthanShoeDev/fressh/actions/workflows/check.yml/badge.svg)](https://github.com/EthanShoeDev/fressh/actions/workflows/check.yml)
[![npm: @fressh/react-native-uniffi-russh](https://img.shields.io/npm/v/%40fressh%2Freact-native-uniffi-russh)](https://www.npmjs.com/package/@fressh/react-native-uniffi-russh)
[![npm: @fressh/react-native-xtermjs-webview](https://img.shields.io/npm/v/%40fressh%2Freact-native-xtermjs-webview)](https://www.npmjs.com/package/@fressh/react-native-xtermjs-webview)

### Features

- **Secure connection history**: Securely store previous connections
- **Theming**: Configurable theme
- **xterm fidelity**: Fully accurate xterm emulation

### Coming soon

- **Command presets**: Configurable preset command buttons
- **On-device AI**: On-device LLM for command completion and output
  summarization

### Screenshots

![Hosts tab](./packages/assets/mobile-screenshots/hosts-tab.png)

![Shell detail](./packages/assets/mobile-screenshots/shell-detail.png)

### Architecture

The app is a monorepo with three main parts:

- **`apps/mobile`**: The actual React Native Expo app.
- **`packages/react-native-uniffi-russh`**: A
  [uniffi react native](https://github.com/jhugman/uniffi-bindgen-react-native)
  binding package that exposes a native Rust module for
  [russh](https://github.com/Eugeny/russh).
- **`packages/react-native-xtermjs-webview`**: A small library that instantiates
  an Expo WebView preloaded with [xterm.js](https://xtermjs.org/).

Both packages are published on npm if you want to use them in your own project:

- [`@fressh/react-native-uniffi-russh`](https://www.npmjs.com/package/@fressh/react-native-uniffi-russh)
- [`@fressh/react-native-xtermjs-webview`](https://www.npmjs.com/package/@fressh/react-native-xtermjs-webview)

### Why

Mostly to practice with React Native, Expo, and Rust. There are a few more
developed SSH clients on the Google Play and iOS App Stores.

Some of those try to lock features like one-off commands behind a paywall, so
this aims to be a free alternative.

Another notable feature of the app is the WebView xterm.js renderer. Using this
as the render layer has a few benefits:

- **Parity with VS Code**: We match the render behavior of VS Code
- **Consistent visuals**: The render layer visually matches on both iOS and
  Android

With that said, it is probably less performant than a native renderer, so it may
be replaced in the future. Implementing a
[Nitro view](https://nitro.margelo.com/docs/view-components) seems very
promising.

### Changelogs

- `apps/mobile`: [`apps/mobile/CHANGELOG.md`](./apps/mobile/CHANGELOG.md)
- `@fressh/react-native-uniffi-russh`:
  [`packages/react-native-uniffi-russh/CHANGELOG.md`](./packages/react-native-uniffi-russh/CHANGELOG.md)
- `@fressh/react-native-xtermjs-webview`:
  [`packages/react-native-xtermjs-webview/CHANGELOG.md`](./packages/react-native-xtermjs-webview/CHANGELOG.md)

### Contributing

We provide a Nix flake devshell to help get a working environment quickly. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for details.

### License

MIT
