---
'@fressh/react-native-terminal': minor
---

Support React Native 0.88 (Expo SDK 58). The Nitro view bindings are regenerated with nitrogen 0.37, so `react-native-nitro-modules` >= 0.37.0 is now required (raised from 0.35.0). Nitro 0.37 fixes the dangling view-props reference upstream, so the local nitrogen patch is gone. `TerminalRenderConfig`'s optional fields now also accept `undefined`, so they can be passed through under `exactOptionalPropertyTypes`.
