# Changelog

## 0.0.9 (2026-06-02)

- Add touch scrollback `pageStep` bridge contract.
- Breaking: remove `prefixKey`, `copyModeKey`, `exitKey`, and `cancelKey` from
  `TouchScrollConfig`.
- Deprecate `emitExit` on exit scrollback contracts. It remains accepted for
  compatibility and is ignored by the WebView bridge.
- Breaking: remove `input.kind='scroll'`.
- Breaking: require `scrollbackBatch.pageStep`.
- Breaking: remove dead `enterDelayMs` config.
- Rename the touch scrollback enter handshake from
  `tmuxEnterCopyMode`/`tmuxEnterCopyModeAck` to
  `scrollbackEnterRequested`/`scrollbackEnterAck`; legacy names remain accepted
  as compatibility aliases.
- Rename the touch scrollback batch handshake from
  `tmuxScrollBatch`/`TmuxScrollBatchEvent`/`onTmuxScrollBatch` to
  `scrollbackBatch`/`ScrollbackBatchEvent`/`onScrollbackBatch`; legacy names
  remain accepted as compatibility aliases.

## [0.0.8](https://github.com/mulyoved/fressh/compare/@fressh/react-native-xtermjs-webview-v0.0.7...${npm.name}-v0.0.8) (2025-10-08)

## [0.0.7](https://github.com/mulyoved/fressh/compare/@fressh/react-native-xtermjs-webview-v0.0.6...${npm.name}-v0.0.7) (2025-10-08)

## [0.0.6](https://github.com/mulyoved/fressh/compare/@fressh/react-native-xtermjs-webview-v0.0.5...${npm.name}-v0.0.6) (2025-10-07)

## [0.0.5](https://github.com/mulyoved/fressh/compare/@fressh/react-native-xtermjs-webview-v0.0.4...${npm.name}-v0.0.5) (2025-10-07)

## [0.0.4](https://github.com/mulyoved/fressh/compare/@fressh/react-native-xtermjs-webview-v0.0.1...${npm.name}-v0.0.4) (2025-10-07)

## 0.0.1 (2025-10-07)
