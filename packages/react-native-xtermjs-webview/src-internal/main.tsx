import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions, type ITheme } from '@xterm/xterm';
import { Base64 } from 'js-base64';
import '@xterm/xterm/css/xterm.css';
import {
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
} from '../src/bridge';

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
const post = (msg: BridgeInboundMessage) =>
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
			const msg = JSON.parse(e.data) as BridgeOutboundMessage;

			if (!msg || typeof msg.type !== 'string') return;

			switch (msg.type) {
				case 'write': {
					if ('b64' in msg) {
						const bytes = Base64.toUint8Array(msg.b64);
						term.write(bytes);
						post({ type: 'debug', message: `write(bytes=${bytes.length})` });
					} else if ('chunks' in msg && Array.isArray(msg.chunks)) {
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
					const patch: Partial<ITerminalOptions> = {};
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
					const theme: Partial<ITheme> = {};
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
					const incoming = (msg.opts ?? {}) as Record<string, unknown>;
					type PatchRecord = Partial<
						Record<
							keyof ITerminalOptions,
							ITerminalOptions[keyof ITerminalOptions]
						>
					>;
					const patch: PatchRecord = {};
					for (const [k, v] of Object.entries(incoming)) {
						// Avoid touching cols/rows via options setters here
						if (k === 'cols' || k === 'rows') continue;
						// Theme: also mirror background to page for seamless visuals
						if (k === 'theme' && v && typeof v === 'object') {
							const theme = v as ITheme;
							if (theme.background) {
								document.body.style.backgroundColor = theme.background;
							}
							patch.theme = theme;
							continue;
						}
						const key = k as keyof ITerminalOptions;
						patch[key] = v as ITerminalOptions[keyof ITerminalOptions];
					}
					if (Object.keys(patch).length) {
						term.options = patch;
						post({
							type: 'debug',
							message: `setOptions(${Object.keys(patch).join(',')})`,
						});
						// If dimensions-affecting options changed, refit
						if (
							patch.fontFamily !== undefined ||
							patch.fontSize !== undefined ||
							patch.letterSpacing !== undefined ||
							patch.lineHeight !== undefined
						) {
							fitAddon.fit();
						}
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
