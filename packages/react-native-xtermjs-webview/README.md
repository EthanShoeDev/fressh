## @fressh/react-native-xtermjs-webview

React Native WebView that embeds [xterm.js](https://xtermjs.org/) with sensible
defaults and a bridge for input and output.

[![npm version](https://img.shields.io/npm/v/%40fressh%2Freact-native-xtermjs-webview)](https://www.npmjs.com/package/@fressh/react-native-xtermjs-webview)

### Install

```bash
pnpm add @fressh/react-native-xtermjs-webview react-native-webview
```

Peer dependencies: `react`, `react-native-webview`.

### Usage

For a complete production example, see the mobile app:
https://github.com/EthanShoeDev/fressh/tree/main/apps/mobile

Basic usage:

```tsx
import React, { useRef } from 'react';
import type { XtermWebViewHandle } from '@fressh/react-native-xtermjs-webview';
import { XtermJsWebView } from '@fressh/react-native-xtermjs-webview';

export function Terminal() {
	const termRef = useRef<XtermWebViewHandle | null>(null);

	return (
		<XtermJsWebView
			ref={termRef}
			onInitialized={() => {
				const hello = new TextEncoder().encode('hello');
				termRef.current?.write(hello);
			}}
			onData={(input) => {
				console.log('user input:', input);
			}}
		/>
	);
}
```

#### Props

- `webViewOptions`: subset of `react-native-webview` props (sane defaults
  applied)
- `xtermOptions`: partial `@xterm/xterm` options (theme, font, scrollback, etc.)
- `onInitialized`: called when the terminal is ready
- `onData(str)`: emits user keystrokes
- `size`: `{ cols, rows }` to set terminal size
- `autoFit`: auto-fit after important changes (default: true)

#### Ref API

- `write(bytes)`, `writeMany([bytes...])`, `flush()`
- `clear()`, `focus()`, `fit()`, `resize({ cols, rows })`

### Publishing contents

This package intentionally publishes both `src/` and built `dist/` artifacts for
transparency and debugging.

### Links

- Changelog:
  [`CHANGELOG.md`](https://github.com/EthanShoeDev/fressh/blob/main/packages/react-native-xtermjs-webview/CHANGELOG.md)
- Contributing:
  [`CONTRIBUTING.md`](https://github.com/EthanShoeDev/fressh/blob/main/CONTRIBUTING.md)
- Example app:
  [`apps/mobile`](https://github.com/EthanShoeDev/fressh/tree/main/apps/mobile)
  and source usage:
  [`apps/mobile/src/app/(tabs)/shell/detail.tsx`](<https://github.com/EthanShoeDev/fressh/blob/main/apps/mobile/src/app/(tabs)/shell/detail.tsx>)
- API source:
  [`src/index.tsx`](https://github.com/EthanShoeDev/fressh/blob/main/packages/react-native-xtermjs-webview/src/index.tsx)
- License: MIT
