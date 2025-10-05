import { Base64 } from 'js-base64';
type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type ITerminalInitOnlyOptions = import('@xterm/xterm').ITerminalInitOnlyOptions;

// ---- History payload shapes
export type CommandMeta = {
	id: string;
	command?: string;
	startTime: number; // epoch ms
	endTime?: number; // epoch ms
	exitCode?: number;
	cwd?: string;
};

export type OutputMeta = {
	id: string;
	byteLength: number;
};

export type OutputItemB64 = {
	id: string;
	bytesB64: string; // base64-encoded bytes
};

export type HistoryEvent =
	| { kind: 'commandStarted'; meta: CommandMeta }
	| { kind: 'commandFinished'; meta: CommandMeta }
	| { kind: 'cwdChanged'; cwd: string };

// Messages posted from the WebView (xterm page) to React Native
export type BridgeInboundMessage =
	| { type: 'initialized' }
	| { type: 'input'; str: string }
	| { type: 'debug'; message: string }
	| { type: 'history:commands'; corr: string; items: CommandMeta[] }
	| { type: 'history:outputs'; corr: string; items: OutputMeta[] }
	| { type: 'history:output'; corr: string; item?: OutputItemB64 }
	| { type: 'history:cleared'; corr: string }
	| { type: 'history:event'; event: HistoryEvent };

// Messages injected from React Native into the WebView (xterm page)
export type BridgeOutboundMessage =
	| { type: 'write'; bStr: string }
	| { type: 'writeMany'; chunks: string[] }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'fit' }
	| {
			type: 'setOptions';
			opts: Partial<Omit<ITerminalOptions, keyof ITerminalInitOnlyOptions>>;
	  }
	| { type: 'clear' }
	| { type: 'focus' }
	| { type: 'history:getCommands'; corr: string; limit?: number }
	| { type: 'history:getOutputs'; corr: string; limit?: number }
	| { type: 'history:getOutput'; corr: string; id: string }
	| { type: 'history:clear'; corr: string };

export const binaryToBStr = (binary: Uint8Array): string =>
	Base64.fromUint8Array(binary);
export const bStrToBinary = (bStr: string): Uint8Array =>
	Base64.toUint8Array(bStr);
