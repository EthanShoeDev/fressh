import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
} from '../src/bridge';
import { createSelectionHandles } from './selection-handles';
import { createTouchScrollController } from './touch-scroll-controller';
import { createXtermWebViewMessageHandler } from './webview-message-handler';

declare global {
	interface Window {
		terminal?: Terminal;
		fitAddon?: FitAddon;
		terminalWriteBase64?: (data: string) => void;
		__FRESSH_XTERM_OPTIONS__?: ITerminalOptions;
		ReactNativeWebView?: {
			postMessage?: (data: string) => void;
			injectedObjectJson?: () => string | undefined;
		};
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
window.onload = () => {
	try {
		if (window.__FRESSH_XTERM_BRIDGE__) {
			sendToRn({
				type: 'debug',
				message: 'bridge already installed; ignoring duplicate boot',
			});
			return;
		}

		const injectedObjectJson =
			window.ReactNativeWebView?.injectedObjectJson?.();
		let injectedObject: ITerminalOptions = {};
		if (injectedObjectJson) {
			try {
				injectedObject = JSON.parse(injectedObjectJson) as ITerminalOptions;
			} catch (err) {
				if (window.__FRESSH_XTERM_OPTIONS__) {
					injectedObject = window.__FRESSH_XTERM_OPTIONS__;
					sendToRn({
						type: 'debug',
						message: 'injectedObjectJson invalid; using preloaded options',
					});
				} else {
					sendToRn({
						type: 'debug',
						message: `injectedObjectJson invalid; using defaults (${String(
							err,
						)})`,
					});
				}
			}
		} else if (window.__FRESSH_XTERM_OPTIONS__) {
			injectedObject = window.__FRESSH_XTERM_OPTIONS__;
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; using preloaded options',
			});
		} else {
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; using defaults',
			});
		}

		window.__FRESSH_XTERM_BRIDGE__ = true;
		const createInstanceId = () => {
			if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
				return crypto.randomUUID();
			}
			return `${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2, 10)}`;
		};
		const instanceId = createInstanceId();

		// ---- Xterm setup
		const term = new Terminal(injectedObject);
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		const root = document.getElementById('terminal')!;
		term.open(root);
		fitAddon.fit();
		if (document.documentElement) {
			document.documentElement.style.overflow = 'hidden';
		}
		if (document.body) {
			document.body.style.overflow = 'hidden';
		}
		if (term.element) {
			term.element.style.position = 'relative';
			term.element.style.overflow = 'hidden';
		}
		root.style.position = 'relative';
		root.style.overflow = 'hidden';

		if (!window.ReactNativeWebView) {
			const devTheme = {
				background: '#0b1220',
				foreground: '#e2e8f0',
				selectionBackground: 'rgba(26, 115, 232, 0.35)',
				selectionInactiveBackground: 'rgba(26, 115, 232, 0.2)',
			};
			term.options.theme = {
				...(term.options.theme ?? {}),
				...devTheme,
			};
			if (document.body) {
				document.body.style.backgroundColor = devTheme.background;
			}
			term.writeln('Fressh handle dev view');
			term.writeln('Long-press to enter selection mode.');
			term.writeln('Use this page to tune selection handles.');
			term.writeln('');
			term.writeln('The quick brown fox jumps over the lazy dog.');
			term.writeln('0123456789 []{}() <>,.?/ +-*/');
		}

		// Send initial size after first fit
		if (term.cols >= 2 && term.rows >= 1) {
			sendToRn({ type: 'sizeChanged', cols: term.cols, rows: term.rows });
		}

		const applyFontFamily = (family?: string) => {
			if (!family) return;
			const rootEl = (term.element ??
				document.querySelector('.xterm')) as HTMLElement | null;
			if (rootEl) rootEl.style.fontFamily = family;
			const helper = document.querySelector(
				'.xterm-helper-textarea',
			) as HTMLElement | null;
			if (helper) helper.style.fontFamily = family;
			const measure = document.querySelector(
				'.xterm-char-measure-element',
			) as HTMLElement | null;
			if (measure) measure.style.fontFamily = family;
		};

		applyFontFamily(injectedObject.fontFamily);

		const selectionHandles = createSelectionHandles({
			term,
			instanceId,
			sendToRn,
		});

		selectionHandles.installLongPressHandlers();
		const touchScrollController = createTouchScrollController({
			term,
			root,
			instanceId,
			sendToRn,
			isSelectionModeEnabled: selectionHandles.isSelectionModeEnabled,
			cancelLongPress: selectionHandles.cancelLongPress,
		});
		term.onResize(() => {
			if (selectionHandles.isSelectionModeEnabled()) {
				selectionHandles.renderSelectionHandles();
			}
			touchScrollController.updateLineHeight();
		});

		// Expose for debugging (typed)
		window.terminal = term;
		window.fitAddon = fitAddon;

		term.onData((data) => {
			sendToRn({ type: 'input', str: data, instanceId, kind: 'typing' });
		});

		// Report terminal size changes back to RN (for PTY resize)
		term.onResize(({ cols, rows }) => {
			if (cols >= 2 && rows >= 1) {
				sendToRn({ type: 'sizeChanged', cols, rows });
			}
		});

		// Remove old handler if any (just in case)
		if (window.__FRESSH_XTERM_MSG_HANDLER__)
			window.removeEventListener(
				'message',
				window.__FRESSH_XTERM_MSG_HANDLER__!,
			);

		const handler = createXtermWebViewMessageHandler({
			instanceId,
			term,
			fitAddon,
			selectionHandles,
			touchScrollController,
			sendToRn,
			applyFontFamily,
		});

		window.__FRESSH_XTERM_MSG_HANDLER__ = handler;
		window.addEventListener('message', handler);

		// Initial handshake (send once)
		setTimeout(() => {
			const ta = document.querySelector(
				'.xterm-helper-textarea',
			) as HTMLTextAreaElement | null;
			if (!ta) throw new Error('xterm-helper-textarea not found');
			ta.setAttribute('autocomplete', 'off');
			ta.setAttribute('autocorrect', 'off');
			ta.setAttribute('autocapitalize', 'none');
			ta.setAttribute('spellcheck', 'false');
			ta.setAttribute('inputmode', 'verbatim');

			return sendToRn({ type: 'initialized', instanceId });
		}, 200);
	} catch (e) {
		sendToRn({
			type: 'debug',
			message: `error in xtermjs-webview: ${String(e)}`,
		});
	}
};
