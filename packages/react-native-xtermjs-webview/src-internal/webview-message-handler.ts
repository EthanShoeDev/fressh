import type { FitAddon } from '@xterm/addon-fit';
import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import {
	bStrToBinary,
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
	type TouchScrollConfig,
} from '../src/bridge';

type SelectionHandles = {
	applySelectionMode: (enabled: boolean, options: { force: true }) => void;
};

type TouchScrollController = {
	setConfig: (config: TouchScrollConfig) => void;
	exitScrollback: (opts?: { requestId?: number }) => void;
	handleEnterAck: (requestId: number) => void;
};

type MessageHandlerTerminal = Pick<
	Terminal,
	| 'cols'
	| 'rows'
	| 'write'
	| 'resize'
	| 'getSelection'
	| 'clear'
	| 'focus'
> & {
	options: ITerminalOptions;
};

export function createXtermWebViewMessageHandler({
	instanceId,
	term,
	fitAddon,
	selectionHandles,
	touchScrollController,
	sendToRn,
	applyFontFamily,
}: {
	instanceId: string;
	term: MessageHandlerTerminal;
	fitAddon: Pick<FitAddon, 'fit'>;
	selectionHandles: SelectionHandles;
	touchScrollController: TouchScrollController;
	sendToRn: (msg: BridgeInboundMessage) => void;
	applyFontFamily: (family?: string) => void;
}) {
	const termWrite = (bStr: string) => {
		const bytes = bStrToBinary(bStr);
		term.write(bytes);
	};

	return (e: MessageEvent<BridgeOutboundMessage>) => {
		try {
			const msg = e.data;

			if (!msg || typeof msg.type !== 'string') return;

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
					if (term.cols >= 2 && term.rows >= 1) {
						sendToRn({
							type: 'sizeChanged',
							cols: term.cols,
							rows: term.rows,
							instanceId,
						});
					}
					break;
				}
				case 'getSelection': {
					const text = term.getSelection();
					sendToRn({
						type: 'selection',
						requestId: msg.requestId,
						text,
						instanceId,
					});
					break;
				}
				case 'setSelectionMode': {
					sendToRn({
						type: 'debug',
						message: `setSelectionMode ${msg.enabled ? 'on' : 'off'}`,
					});
					selectionHandles.applySelectionMode(msg.enabled, { force: true });
					break;
				}
				case 'setTouchScrollConfig': {
					touchScrollController.setConfig(msg.config);
					break;
				}
				case 'exitScrollback': {
					if (msg.instanceId && msg.instanceId !== instanceId) return;
					touchScrollController.exitScrollback({
						requestId: msg.requestId,
					});
					break;
				}
				case 'scrollbackEnterAck':
				case 'tmuxEnterCopyModeAck': {
					if (msg.instanceId !== instanceId) return;
					touchScrollController.handleEnterAck(msg.requestId);
					break;
				}
				case 'setOptions': {
					const { theme, ...rest } = msg.opts;
					for (const key in rest) {
						if (key === 'cols' || key === 'rows') continue;
						const value = rest[key as keyof typeof rest];
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(term.options as any)[key] = value;
					}
					if (theme) {
						term.options.theme = {
							...term.options.theme,
							...theme,
						};
					}
					applyFontFamily(msg.opts.fontFamily);
					if (theme?.background) {
						document.body.style.backgroundColor = theme.background;
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
}
