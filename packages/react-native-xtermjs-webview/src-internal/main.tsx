import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
	bStrToBinary,
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
		__FRESSH_XTERM_MSG_HANDLER__?: (
			e: MessageEvent<BridgeOutboundMessage>,
		) => void;
	}
}

const sendToRn = (msg: BridgeInboundMessage) =>
	window.ReactNativeWebView?.postMessage?.(JSON.stringify(msg));

/**
 * Idempotent boot guard: ensure we only install once.
 * If the script happens to run twice (dev reloads, double-mounts), we bail out early.
 */
if (window.__FRESSH_XTERM_BRIDGE__) {
	sendToRn({
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

	term.onData((data) => {
		sendToRn({ type: 'input', str: data });
	});

	// Remove old handler if any (just in case)
	if (window.__FRESSH_XTERM_MSG_HANDLER__)
		window.removeEventListener('message', window.__FRESSH_XTERM_MSG_HANDLER__!);

	// RN -> WebView handler (write, resize, setFont, setTheme, setOptions, clear, focus)
	const handler = (e: MessageEvent<BridgeOutboundMessage>) => {
		try {
			const msg = e.data;

			if (!msg || typeof msg.type !== 'string') return;

			// TODO: https://xtermjs.org/docs/guides/flowcontrol/#ideas-for-a-better-mechanism
			const termWrite = (bStr: string) => {
				const bytes = bStrToBinary(bStr);
				term.write(bytes);
			};

			switch (msg.type) {
				case 'write': {
					termWrite(msg.bStr);
					break;
				}
				case 'writeMany': {
					for (const bStr of msg.chunks) {
						termWrite(bStr);
					}
					break;
				}
				case 'resize': {
					term.resize(msg.cols, msg.rows);
					break;
				}
				case 'fit': {
					fitAddon.fit();
					break;
				}
				case 'setOptions': {
					const newOpts: ITerminalOptions & { cols?: never; rows?: never } = {
						...term.options,
						...msg.opts,
						theme: {
							...term.options.theme,
							...msg.opts.theme,
						},
					};
					delete newOpts.cols;
					delete newOpts.rows;
					term.options = newOpts;
					if (
						'theme' in newOpts &&
						newOpts.theme &&
						'background' in newOpts.theme &&
						newOpts.theme.background
					) {
						document.body.style.backgroundColor = newOpts.theme.background;
					}
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
			sendToRn({
				type: 'debug',
				message: `message handler error: ${String(err)}`,
			});
		}
	};

	window.__FRESSH_XTERM_MSG_HANDLER__ = handler;
	window.addEventListener('message', handler);

	// Initial handshake (send once)
	setTimeout(() => sendToRn({ type: 'initialized' }), 50);
}
