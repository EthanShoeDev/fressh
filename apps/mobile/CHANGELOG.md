# Changelog

## 0.1.1

### Patch Changes

- Updated dependencies [[`4e111d3`](https://github.com/EthanShoeDev/fressh/commit/4e111d303cebeb899ef7b7177121911198df8092)]:
  - @fressh/react-native-terminal@0.1.1

## 0.1.0

### Minor Changes

- [#13](https://github.com/EthanShoeDev/fressh/pull/13) [`3af8b44`](https://github.com/EthanShoeDev/fressh/commit/3af8b443a616a34cc0a31ccbfd558705857e2065) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - First release cut by the new CI pipeline (changesets → GitHub Actions `eas build --local` → GitHub Release). Highlights since 0.0.4:

  - **iOS support**: the SSH terminal now runs on iOS — russh control plane plus an ANGLE→Metal render plane for the alacritty-based terminal.
  - **Commands tab**: preset manager and a one-off command runner (russh exec) for firing quick commands at a host without opening a shell.
  - **Smarter terminal surface**: context bar, paged toolbar/presets, automatic OSC 633 shell integration (global and per-host settings), and a git-aware status badge with a diff view.
  - **Theming**: new multi-theme system (Phosphor, Graphite, Aurora, Monolith) plus a "Native" theme built from platform controls, with switchable JS/native tab bar.
  - **Quality**: resilient SSH key storage, readable connect errors, keyboard-safe connect form and bottom sheets, host/session rename, and full-width shell terminal.

## [0.0.4](https://github.com/EthanShoeDev/fressh/compare/@fressh/mobile-v0.0.3...${npm.name}-v0.0.4) (2025-10-07)

## [0.0.3](https://github.com/EthanShoeDev/fressh/compare/@fressh/mobile-v0.0.2...${npm.name}-v0.0.3) (2025-10-07)
