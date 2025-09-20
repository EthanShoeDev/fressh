import { Base64 } from 'js-base64';
type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type ITerminalInitOnlyOptions = import('@xterm/xterm').ITerminalInitOnlyOptions;
// Messages posted from the WebView (xterm page) to React Native
export type BridgeInboundMessage =
	| { type: 'initialized' }
	| { type: 'input'; str: string }
	| { type: 'debug'; message: string };

// Messages injected from React Native into the WebView (xterm page)
export type BridgeOutboundMessage =
	| { type: 'write'; bStr: string }
	| { type: 'writeMany'; chunks: string[] }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'fit' }
	| {
		type: 'setOptions'; opts: Partial<
			Omit<ITerminalOptions, keyof ITerminalInitOnlyOptions>
		>
	}
	| { type: 'clear' }
	| { type: 'focus' };

export const binaryToBStr = (binary: Uint8Array): string =>
	Base64.fromUint8Array(binary);
export const bStrToBinary = (bStr: string): Uint8Array =>
	Base64.toUint8Array(bStr);
