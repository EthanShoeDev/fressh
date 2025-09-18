import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Base64 } from 'js-base64';
import '@xterm/xterm/css/xterm.css';

declare global {
	interface Window {
		terminal?: Terminal;
		fitAddon?: FitAddon;
		terminalWriteBase64?: (data: string) => void;
		ReactNativeWebView?: { postMessage?: (data: string) => void };
		__FRESSH_XTERM_BRIDGE__?: boolean;
		__FRESSH_XTERM_MSG_HANDLER__?: (e: MessageEvent<string>) => void;
	}
}

/**
 * Post typed messages to React Native
 */
const post = (msg: unknown) =>
	window.ReactNativeWebView?.postMessage?.(JSON.stringify(msg));

/**
 * Idempotent boot guard: ensure we only install once.
 * If the script happens to run twice (dev reloads, double-mounts), we bail out early.
 */
if (window.__FRESSH_XTERM_BRIDGE__) {
	post({
		type: 'debug',
		message: 'bridge already installed; ignoring duplicate boot',
	});
} else {
	window.__FRESSH_XTERM_BRIDGE__ = true;

	// ---- Xterm setup
	const term = new Terminal({
		allowProposedApi: true,
		convertEol: true,
		scrollback: 10000,
		cursorBlink: true,
	});
	const fitAddon = new FitAddon();
	term.loadAddon(fitAddon);

	const root = document.getElementById('terminal')!;
	term.open(root);
	fitAddon.fit();

	// Expose for debugging (typed)
	window.terminal = term;
	window.fitAddon = fitAddon;

	// Encode helper
	const enc = new TextEncoder();

	// Initial handshake (send once)
	setTimeout(() => post({ type: 'initialized' }), 500);

	// User input from xterm -> RN (SSH) as UTF-8 bytes (Base64)
	term.onData((data /* string */) => {
		const bytes = enc.encode(data);
		const b64 = Base64.fromUint8Array(bytes);
		post({ type: 'input', b64 });
	});

	// Remove old handler if any (just in case)
	if (window.__FRESSH_XTERM_MSG_HANDLER__) {
		window.removeEventListener('message', window.__FRESSH_XTERM_MSG_HANDLER__!);
	}

	// RN -> WebView handler (write, resize, setFont, setTheme, setOptions, clear, focus)
	const handler = (e: MessageEvent<string>) => {
		try {
			const msg = JSON.parse(e.data) as
				| { type: 'write'; b64?: string; chunks?: string[] }
				| { type: 'resize'; cols?: number; rows?: number }
				| { type: 'setFont'; family?: string; size?: number }
				| { type: 'setTheme'; background?: string; foreground?: string }
				| {
						type: 'setOptions';
						opts: Partial<{
							cursorBlink: boolean;
							scrollback: number;
							fontFamily: string;
							fontSize: number;
						}>;
				  }
				| { type: 'clear' }
				| { type: 'focus' };

			if (!msg || typeof msg.type !== 'string') return;

			switch (msg.type) {
				case 'write': {
					if (typeof msg.b64 === 'string') {
						const bytes = Base64.toUint8Array(msg.b64);
						term.write(bytes);
						post({ type: 'debug', message: `write(bytes=${bytes.length})` });
					} else if (Array.isArray(msg.chunks)) {
						for (const b64 of msg.chunks) {
							const bytes = Base64.toUint8Array(b64);
							term.write(bytes);
						}
						post({
							type: 'debug',
							message: `write(chunks=${msg.chunks.length})`,
						});
					}
					break;
				}

				case 'resize': {
					if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
						term.resize(msg.cols, msg.rows);
						post({ type: 'debug', message: `resize(${msg.cols}x${msg.rows})` });
					}
					fitAddon.fit();
					break;
				}

				case 'setFont': {
					const { family, size } = msg;
					const patch: Partial<import('@xterm/xterm').ITerminalOptions> = {};
					if (family) patch.fontFamily = family;
					if (typeof size === 'number') patch.fontSize = size;
					if (Object.keys(patch).length) {
						term.options = patch; // never spread existing options (avoids cols/rows setters)
						post({
							type: 'debug',
							message: `setFont(${family ?? ''}, ${size ?? ''})`,
						});
						fitAddon.fit();
					}
					break;
				}

				case 'setTheme': {
					const { background, foreground } = msg;
					const theme: Partial<import('@xterm/xterm').ITheme> = {};
					if (background) {
						theme.background = background;
						document.body.style.backgroundColor = background;
					}
					if (foreground) theme.foreground = foreground;
					if (Object.keys(theme).length) {
						term.options = { theme }; // set only theme
						post({
							type: 'debug',
							message: `setTheme(bg=${background ?? ''}, fg=${foreground ?? ''})`,
						});
					}
					break;
				}

				case 'setOptions': {
					const opts = msg.opts ?? {};
					const { cursorBlink, scrollback, fontFamily, fontSize } = opts;
					const patch: Partial<import('@xterm/xterm').ITerminalOptions> = {};
					if (typeof cursorBlink === 'boolean') patch.cursorBlink = cursorBlink;
					if (typeof scrollback === 'number') patch.scrollback = scrollback;
					if (fontFamily) patch.fontFamily = fontFamily;
					if (typeof fontSize === 'number') patch.fontSize = fontSize;
					if (Object.keys(patch).length) {
						term.options = patch;
						post({
							type: 'debug',
							message: `setOptions(${Object.keys(patch).join(',')})`,
						});
						if (patch.fontFamily || patch.fontSize) fitAddon.fit();
					}
					break;
				}

				case 'clear': {
					term.clear();
					post({ type: 'debug', message: 'clear()' });
					break;
				}

				case 'focus': {
					term.focus();
					post({ type: 'debug', message: 'focus()' });
					break;
				}
			}
		} catch (err) {
			post({ type: 'debug', message: `message handler error: ${String(err)}` });
		}
	};

	window.__FRESSH_XTERM_MSG_HANDLER__ = handler;
	window.addEventListener('message', handler);
}
