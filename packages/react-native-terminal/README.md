# @fressh/react-native-terminal

[![npm](https://img.shields.io/npm/v/@fressh/react-native-terminal)](https://www.npmjs.com/package/@fressh/react-native-terminal)
[![npm canary](https://img.shields.io/npm/v/@fressh/react-native-terminal/canary?label=canary&color=orange)](https://www.npmjs.com/package/@fressh/react-native-terminal?activeTab=versions)

Native SSH terminal for React Native, in **one package / one `.so`**:

- **SSH** via russh (`fressh-ssh`)
- **VT engine** via `alacritty_terminal` — durable, parsed `Term` state
- **Native renderer** via Alacritty's GLES2 renderer (`fressh-render`) — no xterm.js WebView
- **Registry-owned sessions** (`fressh-core`) → tmux-style reattach, full scrollback on
  re-entry, no byte replay

It renders natively on **Android (EGL/GLES2) and iOS (GLES2 via ANGLE → Metal)** and is
used in production by the [fressh](https://github.com/EthanShoeDev/fressh) app. It replaces
the earlier `@fressh/react-native-uniffi-russh` + `@fressh/react-native-xtermjs-webview`.

> **`0.1.0` — experimental.** Functionality is solid on both platforms; the **public API
> may still change** before `1.0`.

## Requirements

- **React Native ≥ 0.85** with the **New Architecture enabled** — this is a
  [Nitro](https://nitro.margelo.com) module.
- Peer deps: `react`, `react-native`, `react-native-nitro-modules`.
- **Android:** `minSdkVersion ≥ 26`. Ships prebuilt `arm64-v8a` + `x86_64` (no
  `armeabi-v7a` / `x86`).
- **iOS:** deployment target **≥ 16.4**; `arm64` device + simulator.
- **Expo:** works with **CNG / `expo prebuild` + a
  [dev client](https://docs.expo.dev/develop/development-builds/introduction/)** — it has
  native code, so **not** Expo Go. No config plugin is needed; autolinking handles linking.

## Install

```sh
bun add @fressh/react-native-terminal
bun add react-native-nitro-modules   # peer dep, if not already present
```

**Bare React Native** — `cd ios && pod install` (autolinking discovers the podspec); Android
autolinks via Gradle. No manual native wiring.

**Expo** — add a dev client and prebuild:

```sh
bun add expo-dev-client
bunx expo prebuild
```

Enforce the build floors with `expo-build-properties` in `app.config.ts` / `app.json`:

```ts
plugins: [
	[
		'expo-build-properties',
		{ android: { minSdkVersion: 26 }, ios: { deploymentTarget: '16.4' } },
	],
];
```

### Prerelease channels

```sh
bun add @fressh/react-native-terminal@canary   # latest CI canary (0.0.0-canary-<commit>)
bun add @fressh/react-native-terminal@rc        # release-candidate line, when active
```

## Usage

Connect, answer the host-key prompt, open a shell, and render it. **Bytes never cross JS** —
the native `<Terminal>` view owns rendering and input.

```tsx
import { useEffect, useState } from 'react';
import {
	Terminal,
	addFresshEventListener,
	connect,
	respondToHostKey,
	startShell,
	FresshEvent_Tags,
	Security,
	TerminalType,
	type ShellId,
} from '@fressh/react-native-terminal';

export function TerminalScreen() {
	const [shellId, setShellId] = useState<ShellId | null>(null);

	useEffect(() => {
		// One event stream carries connect progress, host-key prompts, and close events.
		const unsubscribe = addFresshEventListener((event) => {
			if (event.tag === FresshEvent_Tags.HostKeyPending) {
				// event.inner.info has the server key fingerprint — show it, then accept/reject.
				respondToHostKey(event.inner.connectionId, true);
			}
		});

		void (async () => {
			const connectionId = await connect({
				host: 'example.com',
				port: 22,
				username: 'me',
				security: new Security.Password({ password: '…' }),
				// …or key auth: new Security.Key({ privateKeyContent: pem })
			});
			const id = await startShell(connectionId, {
				term: TerminalType.Xterm256,
				cols: 80,
				rows: 24,
				scrollbackLines: 10_000,
			});
			setShellId(id);
		})();

		return unsubscribe;
	}, []);

	return shellId ? <Terminal shellId={shellId} style={{ flex: 1 }} /> : null;
}
```

`<Terminal shellId>` reattaches to the durable `Term` that `fressh-core` keeps for that
`shellId`, so re-mounting restores full scrollback with no replay. Font size / colors are
driven by the `config` prop (`TerminalRenderConfig`). For a one-off command without a PTY,
use `runCommand(connectionId, cmd)`; generate keys with `generateKeyPair(KeyType.Ed25519)`.

The full surface is in the exported TypeScript types: `connect`, `startShell`, `runCommand`,
`sendData`, `resize`, `scroll`, the selection helpers, `generateKeyPair`,
`validatePrivateKey`, and the `FresshEvent` stream.

---

## Architecture — the four planes

| Plane   | Path                                            | Crosses JS?           |
| ------- | ----------------------------------------------- | --------------------- |
| Control | JS `src/ssh.ts` → shim (uniffi) → `fressh-core` | yes (rare, async)     |
| Event   | `fressh-core` → shim → JS (one-way sink)        | yes (rare)            |
| Render  | Nitro view ↔ `fressh-core` C-ABI                | **never**             |
| Data    | SSH bytes → reader loop → `Term`                | **never (pure Rust)** |

SSH bytes feed a durable `alacritty_terminal` `Term` entirely in Rust; the Nitro view draws
that `Term` over a C-ABI without round-tripping through JS. iOS renders the same GLES2 path
through **ANGLE** (→ Metal); ANGLE's `libEGL` / `libGLESv2` xcframeworks are vendored in the
podspec.

## Layout

```
react-native-terminal/
├── rust/                     # ONE cargo workspace
│   ├── fressh-ssh/           # russh wrapper
│   ├── fressh-render/        # Alacritty GLES2 renderer over Term
│   ├── fressh-core/          # runtime + registry + sessions + C-ABI
│   └── shim-uniffi/          # thin binding shim (control plane + render C-ABI)
├── nitro/Terminal.nitro.ts   # native view spec (render plane)
├── src/                      # TS public API (Terminal, ssh control plane)
├── cpp/ android/ ios/        # hand-authored umbrella native glue
└── ReactNativeTerminal.podspec · ubrn.config.yaml · package.json
```

## Design & internals

Full design rationale, the renderer-extraction decisions, and the rejected alternatives live
in the design doc:
[`native-rendering-refactor.md`](https://github.com/EthanShoeDev/fressh/blob/main/docs/projects/complete/native-rendering-refactor.md).

### Contributing (Rust toolchain)

The npm tarball ships **prebuilt** native binaries, so consumers need no Rust toolchain.
Contributors build from the repo (the Alacritty / crossfont forks are git submodules under
`rust/vendor/`):

```sh
bun run cargo:fmt:fix     # cargo fmt --all
bun run cargo:lint:fix    # cargo clippy --workspace --fix -D warnings
bun run cargo:test        # cargo test --workspace
```

Lint levels are defined once in `rust/Cargo.toml` `[workspace.lints]` and inherited per-crate
via `[lints] workspace = true`.
