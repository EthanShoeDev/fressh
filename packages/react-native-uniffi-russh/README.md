## @fressh/react-native-uniffi-russh

React Native bindings (via UniFFI) for the Rust SSH library
[russh](https://github.com/Eugeny/russh).

[![npm version](https://img.shields.io/npm/v/%40fressh%2Freact-native-uniffi-russh)](https://www.npmjs.com/package/@fressh/react-native-uniffi-russh)

### Install

```bash
pnpm add @fressh/react-native-uniffi-russh
```

Peer dependencies (you manage): `react`, `react-native`.

### Usage

This package exposes a native Rust module for SSH transport. For a complete,
working integration, see the example app:

- https://github.com/EthanShoeDev/fressh/tree/main/apps/mobile

### API overview

High-level API surface (see code for full types):

```ts
import { RnRussh } from '@fressh/react-native-uniffi-russh';

await RnRussh.uniffiInitAsync();

const conn = await RnRussh.connect({
	host: 'example.com',
	port: 22,
	username: 'me',
	security: { type: 'password', password: '...' },
	onServerKey: async () => true,
});

const shell = await conn.startShell({ term: 'Xterm' });
shell.addListener(
	(ev) => {
		// handle TerminalChunk or DropNotice
	},
	{ cursor: { mode: 'live' } },
);
```

### Links

- Changelog:
  [`CHANGELOG.md`](https://github.com/EthanShoeDev/fressh/blob/main/packages/react-native-uniffi-russh/CHANGELOG.md)
- Contributing:
  [`CONTRIBUTING.md`](https://github.com/EthanShoeDev/fressh/blob/main/CONTRIBUTING.md)
- API source:
  [`src/api.ts`](https://github.com/EthanShoeDev/fressh/blob/main/packages/react-native-uniffi-russh/src/api.ts)
- License: MIT
