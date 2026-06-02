import { Base64 } from 'js-base64';
type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type ITerminalInitOnlyOptions = import('@xterm/xterm').ITerminalInitOnlyOptions;
// Messages posted from the WebView (xterm page) to React Native
export type BridgeInboundMessage =
	| { type: 'initialized'; instanceId: string }
	| {
			type: 'input';
			str: string;
			instanceId: string;
			kind?: 'typing';
	  }
	| { type: 'debug'; message: string }
	| { type: 'sizeChanged'; cols: number; rows: number }
	| { type: 'selection'; requestId: number; text: string; instanceId: string }
	| { type: 'selectionChanged'; text: string; instanceId: string }
	| { type: 'selectionModeChanged'; enabled: boolean; instanceId: string }
	| {
			type: 'scrollbackModeChanged';
			active: boolean;
			phase: 'dragging' | 'active';
			instanceId: string;
			requestId?: number;
	  }
	| { type: 'tmuxEnterCopyMode'; instanceId: string; requestId: number }
	| {
			type: 'tmuxScrollBatch';
			direction: 'up' | 'down';
			pages: number;
			lines: number;
			pageStep: number;
			instanceId: string;
			seq?: number;
			ts?: number;
	  };

export type TmuxScrollBatchBridgeMessage = Extract<
	BridgeInboundMessage,
	{ type: 'tmuxScrollBatch' }
>;

export type TmuxScrollBatchEvent = Omit<TmuxScrollBatchBridgeMessage, 'type'>;

export function mapTmuxScrollBatchMessage(
	msg: TmuxScrollBatchBridgeMessage,
): TmuxScrollBatchEvent {
	return {
		direction: msg.direction,
		pages: msg.pages,
		lines: msg.lines,
		pageStep: msg.pageStep,
		instanceId: msg.instanceId,
		seq: msg.seq,
		ts: msg.ts,
	};
}

export type TouchScrollConfig =
	| { enabled: false }
	| {
			enabled: true;
			pxPerLine?: number;
			slopPx?: number;
			maxLinesPerFrame?: number;
			flickVelocity?: number;
			invertScroll?: boolean;
			coalesceMs?: number;
			minFlushMs?: number;
			maxFlushMs?: number;
			maxPagesPerFlush?: number;
			maxExtraLines?: number;
			maxBacklogPages?: number;
			velocityMultiplierEnabled?: boolean;
			velocityThreshold?: number;
			velocityBoost?: number;
			velocityBoostMax?: number;
			velocitySmoothing?: number;
			backlogMultiplierEnabled?: boolean;
			backlogBoostRefPages?: number;
			backlogBoostMax?: number;
			rttEwmaAlpha?: number;
			debugOverlay?: boolean;
			debugTelemetry?: boolean;
			debugTelemetryIntervalMs?: number;
			debug?: boolean;
	  };

// Messages injected from React Native into the WebView (xterm page)
export type BridgeOutboundMessage =
	| { type: 'write'; bStr: string }
	| { type: 'writeMany'; chunks: string[] }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'fit' }
	| { type: 'getSelection'; requestId: number }
	| { type: 'setSelectionMode'; enabled: boolean }
	| { type: 'setTouchScrollConfig'; config: TouchScrollConfig }
	| { type: 'exitScrollback'; requestId?: number }
	| {
			type: 'tmuxEnterCopyModeAck';
			requestId: number;
			instanceId: string;
	  }
	| {
			type: 'setOptions';
			opts: Partial<Omit<ITerminalOptions, keyof ITerminalInitOnlyOptions>>;
	  }
	| { type: 'clear' }
	| { type: 'focus' };

export const binaryToBStr = (binary: Uint8Array): string =>
	Base64.fromUint8Array(binary);
export const bStrToBinary = (bStr: string): Uint8Array =>
	Base64.toUint8Array(bStr);
