# Add command detection and history to the RN xterm WebView

## What we'll build

- In-WebView OSC-633 parser for VS Code shell integration sequences (A/B/C/D/E,
  P=Cwd) to get exact command boundaries when present. Falls back to heuristics
  (Enter-based + prompt learning + alt-screen guard) when sequences are absent.
  No persistent server install required; optional ephemeral per-session sourcing
  is supported later.
- Ring buffers in WebView to store last N commands and their outputs, with size
  caps.
- New bridge messages and imperative methods so RN can query: last N commands,
  last N outputs, and a specific command’s output.

## Key files to change

- packages/react-native-xtermjs-webview/src-internal/main.tsx
  - Register xterm OSC handler for 633; parse “A/B/C/D/E” and “P;Cwd=…”.
  - Track command state and outputs; implement a capped in-memory store.
  - Respect a runtime flag from injected options to fully disable command
    tracking/history.
  - Add message handler for queries (from RN) and send responses.

- packages/react-native-xtermjs-webview/src/bridge.ts
  - Extend `BridgeOutboundMessage` (RN→WebView) with query messages.
  - Extend `BridgeInboundMessage` (WebView→RN) with responses and optional
    events.

- packages/react-native-xtermjs-webview/src/index.tsx
  - Add prop `enableCommandHistory?: boolean` (default true). When false, do not
    enable OSC handlers/heuristics or allocate history in the WebView.
  - Extend `XtermWebViewHandle` with:
    - `getRecentCommands(limit?: number)`
    - `getRecentOutputs(limit?: number)`
    - `getCommandOutput(id: string)`
    - `clearHistory()`
  - Implement a simple request/response over `injectJavaScript` using
    correlation IDs.

- apps/mobile/src/app/(tabs)/shell/detail.tsx
  - Show example usage via the existing `xtermRef` to fetch recent
    commands/outputs on demand.

## Implementation details

- OSC-633 parsing
  - Use xterm proposed API to register an OSC handler when available:
    `terminal.parser.registerOscHandler(633, handler)`.
  - Handle sequences per VS Code docs: `A` (prompt start), `B` (prompt end), `C`
    (pre-exec), `D[;code]` (post-exec), `E;<escapedCmd>[;nonce]`, `P;Cwd=…`.
  - References: VS Code docs and sources.

- Heuristic fallback (no sequences)
  - Track local keystrokes (we already have them) to build a transient “input
    line buffer”.
  - On Enter (\r or \r\n) outside alt-screen (CSI ? 1049/47/1047 toggles), emit
    a best-effort “command started”.
  - Detect new prompt by screen change patterns (stable prompt prefix on the
    left) to close a command when possible; otherwise time out and roll forward.
  - Disable detection while in full-screen TUIs (alt screen), and ignore
    bracketed paste blocks.

- Storage
  - Maintain two ring buffers with caps (defaults: 100 commands, 1 MB output per
    command; configurable via injected options later).
  - Each entry:
    `{ id, command, startTime, endTime?, exitCode?, cwd?, outputBytes[] }`.

- Bridge extensions
  - RN→WebView: `{ type: 'history:getCommands', limit? }`,
    `{ type: 'history:getOutputs', limit? }`,
    `{ type: 'history:getOutput', id }`, `{ type: 'history:clear' }`.
  - WebView→RN responses: `{ type: 'history:commands', corr, items }`,
    `{ type: 'history:outputs', corr, items }`,
    `{ type: 'history:output', corr, item }`,
    `{ type: 'history:cleared', corr }`.
  - Optional event stream for live updates: `{ type: 'history:event', event }`.

- Imperative handle
  - Implement methods that send queries with a correlation ID and await the
    matching response via `onMessage`.

## Critical code touchpoints

- Where to hook OSC parsing and input/output

```150:176:packages/react-native-xtermjs-webview/src-internal/main.tsx
		term.onData((data) => {
			sendToRn({ type: 'input', str: data });
		});
```

- Where to expose new methods

```231:246:packages/react-native-xtermjs-webview/src/index.tsx
	useImperativeHandle(ref, () => ({
		write,
		writeMany,
		flush,
		clear: () => sendToWebView({ type: 'clear' }),
		focus: () => {
			sendToWebView({ type: 'focus' });
			webRef.current?.requestFocus();
		},
		resize: (size: { cols: number; rows: number }) => {
			sendToWebView({ type: 'resize', cols: size.cols, rows: size.rows });
			autoFitFn();
			appliedSizeRef.current = size;
		},
		fit,
	}));
```

## Optional enhancement (no install, ephemeral session-only)

- On session open, send a one-shot, in-memory sourced shell snippet
  (bash/zsh/fish/pwsh) to enable OSC 633 for that session only. No files written
  server-side. If disabled by user, fallback to heuristics.

## References

- VS Code Shell Integration docs (OSC 633, iTerm/FinalTerm sequences)
  [Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- VS Code sources: `shellIntegrationAddon.ts`, `commandDetectionCapability.ts`,
  `terminalEnvironment.ts`:
  - [shellIntegrationAddon.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts)
  - [commandDetectionCapability.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/capabilities/commandDetectionCapability.ts)
  - [terminalEnvironment.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalEnvironment.ts)
- Shell scripts (for optional ephemeral sourcing):
  - [shellIntegration-bash.sh](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh)
  - [shellIntegration.ps1](https://cocalc.com/github/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1?utm_source=chatgpt.com)
  - [Fish integration discussion](https://github.com/microsoft/vscode/issues/184659?utm_source=chatgpt.com)
