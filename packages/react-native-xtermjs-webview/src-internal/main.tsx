import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
	bStrToBinary,
	binaryToBStr,
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
	type CommandMeta,
	type OutputMeta,
} from '../src/bridge';

declare global {
	interface Window {
		terminal?: Terminal;
		fitAddon?: FitAddon;
		terminalWriteBase64?: (data: string) => void;
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
		if (!injectedObjectJson) {
			sendToRn({
				type: 'debug',
				message: 'injectedObjectJson not found; ignoring duplicate boot',
			});
			return;
		}

		window.__FRESSH_XTERM_BRIDGE__ = true;

		const injectedObject = JSON.parse(
			injectedObjectJson,
		) as ITerminalOptions & {
			__fresshEnableCommandHistory?: boolean;
		};

		// ---- Xterm setup
		const term = new Terminal(injectedObject);
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		const root = document.getElementById('terminal')!;
		term.open(root);
		fitAddon.fit();

		// Expose for debugging (typed)
		window.terminal = term;
		window.fitAddon = fitAddon;

		let sawOsc633 = false;
		let inputBuffer = '';
		term.onData((data) => {
			sendToRn({ type: 'input', str: data });
			if (enableHistory && !sawOsc633) {
				for (let i = 0; i < data.length; i++) {
					const ch = data[i];
					if (ch === '\\r' || ch === '\\n') {
						if (current) finishCommand(undefined);
						const cmd = inputBuffer.trim();
						inputBuffer = '';
						if (cmd.length > 0) startCommand(cmd);
					} else {
						inputBuffer += ch;
					}
				}
			}
		});

		// ---- Command history tracking (OSC 633 and minimal heuristics)
		const enableHistory = injectedObject.__fresshEnableCommandHistory ?? true;

		type MutableCommand = CommandMeta & {
			_output: Uint8Array;
			_truncated: boolean;
		};
		const maxCommands = 100;
		const maxBytesPerCommand = 1 * 1024 * 1024; // 1MB

		const commands: MutableCommand[] = [];
		let current: MutableCommand | null = null;
		let cwd: string | undefined = undefined;

		function pushCommand(cmd: MutableCommand) {
			if (commands.length >= maxCommands) commands.shift();
			commands.push(cmd);
		}

		function startCommand(command?: string) {
			const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			current = {
				id,
				command,
				startTime: Date.now(),
				cwd,
				_output: new Uint8Array(0),
				_truncated: false,
			};
			sendToRn({
				type: 'history:event',
				event: { kind: 'commandStarted', meta: { ...current } },
			});
		}

		function finishCommand(exitCode?: number) {
			if (!current) return;
			current.endTime = Date.now();
			if (exitCode != null) current.exitCode = exitCode;
			pushCommand(current);
			sendToRn({
				type: 'history:event',
				event: { kind: 'commandFinished', meta: { ...current } },
			});
			current = null;
		}

		function appendOutput(bytes: Uint8Array) {
			if (!current) return;
			if (current._truncated) return;
			const newLen = current._output.length + bytes.length;
			if (newLen > maxBytesPerCommand) {
				const allowed = Math.max(
					0,
					maxBytesPerCommand - current._output.length,
				);
				if (allowed > 0) {
					const merged = new Uint8Array(current._output.length + allowed);
					merged.set(current._output, 0);
					merged.set(bytes.subarray(0, allowed), current._output.length);
					current._output = merged;
				}
				current._truncated = true;
				return;
			}
			const merged = new Uint8Array(newLen);
			merged.set(current._output, 0);
			merged.set(bytes, current._output.length);
			current._output = merged;
		}

		if (enableHistory) {
			// OSC 633 handler
			try {
				term.parser.registerOscHandler(633, (data: string) => {
					sawOsc633 = true;
					// data like: 'A' | 'B' | 'C' | 'D;0' | 'E;...escapedCmd[;nonce]' | 'P;Cwd=/path'
					if (!data) return true;
					const semi = data.indexOf(';');
					const tag = semi === -1 ? data : data.slice(0, semi);
					const rest = semi === -1 ? '' : data.slice(semi + 1);
					switch (tag) {
						case 'P': {
							// property
							// format: Cwd=<cwd>
							const eq = rest.indexOf('=');
							if (eq !== -1) {
								const key = rest.slice(0, eq);
								const value = rest.slice(eq + 1);
								if (key === 'Cwd') {
									cwd = value;
									sendToRn({
										type: 'history:event',
										event: { kind: 'cwdChanged', cwd: value },
									});
								}
							}
							return true;
						}
						case 'E': {
							// explicit command line
							// command is escaped: requires unescaping \ and \xAB (hex)
							let cmdRaw = rest;
							const semi2 = cmdRaw.indexOf(';');
							if (semi2 !== -1) cmdRaw = cmdRaw.slice(0, semi2);
							// unescape
							const unescaped = cmdRaw
								.replace(/\\x([0-9a-fA-F]{2})/g, (_m, p1) =>
									String.fromCharCode(parseInt(p1, 16)),
								)
								.replace(/\\\\/g, '\\');
							// save for upcoming run if we start immediately
							if (current) current.command = unescaped;
							else startCommand(unescaped);
							return true;
						}
						case 'C': {
							// pre-execution
							if (!current) startCommand();
							return true;
						}
						case 'D': {
							// execution finished
							let code: number | undefined = undefined;
							if (rest) {
								const n = Number(rest);
								if (!Number.isNaN(n)) code = n;
							}
							finishCommand(code);
							return true;
						}
						// 'A' and 'B' (prompt markers) are ignored for storage here
						default:
							return true; // swallow
					}
				});
			} catch (e) {
				sendToRn({
					type: 'debug',
					message: `OSC633 handler error: ${String(e)}`,
				});
			}
		}

		// Remove old handler if any (just in case)
		if (window.__FRESSH_XTERM_MSG_HANDLER__)
			window.removeEventListener(
				'message',
				window.__FRESSH_XTERM_MSG_HANDLER__!,
			);

		// RN -> WebView handler (write, resize, setFont, setTheme, setOptions, clear, focus, history queries)
		const handler = (e: MessageEvent<BridgeOutboundMessage>) => {
			try {
				const msg = e.data;

				if (!msg || typeof msg.type !== 'string') return;

				// TODO: https://xtermjs.org/docs/guides/flowcontrol/#ideas-for-a-better-mechanism
				const termWrite = (bStr: string) => {
					const bytes = bStrToBinary(bStr);
					term.write(bytes);
					if (enableHistory) appendOutput(bytes);
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
					case 'history:getCommands': {
						const items: CommandMeta[] = commands.map((c) => ({
							id: c.id,
							command: c.command,
							startTime: c.startTime,
							endTime: c.endTime,
							exitCode: c.exitCode,
							cwd: c.cwd,
						}));
						const lim = msg.limit ?? items.length;
						sendToRn({
							type: 'history:commands',
							corr: msg.corr,
							items: items.slice(-lim),
						});
						break;
					}
					case 'history:getOutputs': {
						const items: OutputMeta[] = commands.map((c) => ({
							id: c.id,
							byteLength: c._output.length,
						}));
						const lim = msg.limit ?? items.length;
						sendToRn({
							type: 'history:outputs',
							corr: msg.corr,
							items: items.slice(-lim),
						});
						break;
					}
					case 'history:getOutput': {
						const found = commands.find((c) => c.id === msg.id);
						if (!found) {
							sendToRn({
								type: 'history:output',
								corr: msg.corr,
								item: undefined,
							});
							break;
						}
						sendToRn({
							type: 'history:output',
							corr: msg.corr,
							item: { id: found.id, bytesB64: binaryToBStr(found._output) },
						});
						break;
					}
					case 'history:clear': {
						commands.length = 0;
						current = null;
						sendToRn({ type: 'history:cleared', corr: msg.corr });
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

			return sendToRn({ type: 'initialized' });
		}, 200);
	} catch (e) {
		sendToRn({
			type: 'debug',
			message: `error in xtermjs-webview: ${String(e)}`,
		});
	}
};
