type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;

// Messages posted from the WebView (xterm page) to React Native
export type BridgeInboundMessage =
	| { type: 'initialized' }
	| { type: 'input'; b64: string }
	| { type: 'debug'; message: string };

// Messages injected from React Native into the WebView (xterm page)
export type BridgeOutboundMessage =
	| { type: 'write'; b64: string }
	| { type: 'write'; chunks: string[] }
	| { type: 'resize'; cols?: number; rows?: number }
	| { type: 'setFont'; family?: string; size?: number }
	| { type: 'setTheme'; background?: string; foreground?: string }
	| { type: 'setOptions'; opts: Partial<ITerminalOptions> }
	| { type: 'clear' }
	| { type: 'focus' };

export type TerminalOptionsPatch = BridgeOutboundMessage extends {
	type: 'setOptions';
	opts: infer O;
}
	? O
	: never;
