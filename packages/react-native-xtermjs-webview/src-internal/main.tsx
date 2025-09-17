import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Base64 } from 'js-base64';
import '@xterm/xterm/css/xterm.css';

/**
 * Xterm setup
 */
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

// Expose for debugging (optional)
window.terminal = term;
window.fitAddon = fitAddon;

/**
 * Post typed messages to React Native
 */
const post = (msg: unknown) =>
	window.ReactNativeWebView?.postMessage?.(JSON.stringify(msg));

/**
 * Encode/decode helpers
 */
const enc = new TextEncoder();

/**
 * Initial handshake
 */
setTimeout(() => post({ type: 'initialized' }), 0);

/**
 * User input from xterm -> RN (SSH)
 * Send UTF-8 bytes only (Base64-encoded)
 */
term.onData((data /* string */) => {
	const bytes = enc.encode(data);
	const b64 = Base64.fromUint8Array(bytes);
	post({ type: 'input', b64 });
});

/**
 * Message handler for RN -> WebView control/data
 * We support: write, resize, setFont, setTheme, clear, focus
 */
window.addEventListener('message', (e: MessageEvent<string>) => {
	try {
		const msg = JSON.parse(e.data);
		if (!msg || typeof msg.type !== 'string') return;

		switch (msg.type) {
			case 'write': {
				// Either a single b64 or an array of chunks
				if (typeof msg.b64 === 'string') {
					const bytes = Base64.toUint8Array(msg.b64);
					term.write(bytes);
				} else if (Array.isArray(msg.chunks)) {
					for (const b64 of msg.chunks) {
						const bytes = Base64.toUint8Array(b64);
						term.write(bytes);
					}
				}
				break;
			}

			case 'resize': {
				if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
					try {
						term.resize(msg.cols, msg.rows);
					} finally {
						fitAddon.fit();
					}
				} else {
					// If cols/rows not provided, try fit
					fitAddon.fit();
				}
				break;
			}

			case 'setFont': {
				const { family, size } = msg;
				if (family) document.body.style.fontFamily = family;
				if (typeof size === 'number')
					document.body.style.fontSize = `${size}px`;
				fitAddon.fit();
				break;
			}

			case 'setTheme': {
				const { background, foreground } = msg;
				if (background) document.body.style.backgroundColor = background;
				// xterm theme API (optional)
				term.options = {
					...term.options,
					theme: {
						...(term.options.theme ?? {}),
						background,
						foreground,
					},
				};
				break;
			}

			case 'clear': {
				term.clear();
				break;
			}

			case 'focus': {
				term.focus();
				break;
			}
		}
	} catch (err) {
		post({ type: 'debug', message: `message handler error: ${String(err)}` });
	}
});

/**
 * Handle container resize
 */
new ResizeObserver(() => {
	try {
		fitAddon.fit();
	} catch (err) {
		post({ type: 'debug', message: `resize observer error: ${String(err)}` });
	}
});
