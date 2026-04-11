type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;

export function createDefaultXtermOptions(): Partial<ITerminalOptions> {
	return {
		allowProposedApi: true,
		convertEol: false,
		scrollback: 10000,
		cursorBlink: true,
		// Tablet focus-mode defaults (JetBrains Mono preferred).
		// Note: WebView must have the font available or it will fall back.
		fontFamily:
			'"JetBrains Mono", "Roboto Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", monospace',
		fontSize: 16,
	};
}
