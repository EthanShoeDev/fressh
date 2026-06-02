import { type BridgeInboundMessage } from './bridge';

export type XtermJsWebViewMessageHandlerOptions = {
	rawData: string;
	currentInstanceId?: string | null;
	setCurrentInstanceId?: (instanceId: string) => void;
	clearPendingSelections?: () => void;
	resolveSelection?: (requestId: number, text: string) => boolean;
	onInitialized?: (instanceId: string) => void;
	onAutoFit?: () => void;
	onSetInitialized?: (initialized: boolean) => void;
	onData?: (data: string) => void;
	onInput?: (input: {
		str: string;
		kind: 'typing' | 'scroll';
		instanceId: string;
	}) => void;
	onResize?: (cols: number, rows: number) => void;
	onSelection?: (text: string) => void;
	onSelectionModeChange?: (enabled: boolean) => void;
	onScrollbackModeChange?: (event: {
		active: boolean;
		phase: 'dragging' | 'active';
		instanceId: string;
		requestId?: number;
	}) => void;
	onTmuxEnterCopyMode?: (event: {
		instanceId: string;
		requestId: number;
	}) => void;
	onTmuxScrollBatch?: (event: {
		direction: 'up' | 'down';
		pages: number;
		lines: number;
		pageStep: number;
		instanceId: string;
		seq?: number;
		ts?: number;
	}) => void;
	onUnhandled?: () => void;
	logger?: {
		log?: (...args: unknown[]) => void;
		warn?: (...args: unknown[]) => void;
	};
};

export function handleXtermJsWebViewMessage({
	rawData,
	currentInstanceId,
	setCurrentInstanceId,
	clearPendingSelections,
	resolveSelection,
	onInitialized,
	onAutoFit,
	onSetInitialized,
	onData,
	onInput,
	onResize,
	onSelection,
	onSelectionModeChange,
	onScrollbackModeChange,
	onTmuxEnterCopyMode,
	onTmuxScrollBatch,
	onUnhandled,
	logger,
}: XtermJsWebViewMessageHandlerOptions): boolean {
	const msg: BridgeInboundMessage = JSON.parse(rawData);
	logger?.log?.(`received msg from webview: `, msg);
	if (msg.type === 'initialized') {
		setCurrentInstanceId?.(msg.instanceId);
		clearPendingSelections?.();
		onInitialized?.(msg.instanceId);
		onAutoFit?.();
		onSetInitialized?.(true);
		return true;
	}
	if (
		'instanceId' in msg &&
		currentInstanceId &&
		msg.instanceId !== currentInstanceId
	) {
		logger?.warn?.(`dropping stale webview message`, msg.type, msg.instanceId);
		return true;
	}
	if (msg.type === 'input') {
		const kind = msg.kind ?? 'typing';
		onInput?.({ str: msg.str, kind, instanceId: msg.instanceId });
		if (kind === 'typing') {
			onData?.(msg.str);
		}
		return true;
	}
	if (msg.type === 'debug') {
		logger?.log?.(`received debug msg from webview: `, msg.message);
		return true;
	}
	if (msg.type === 'sizeChanged') {
		logger?.log?.(`terminal size changed: ${msg.cols}x${msg.rows}`);
		onResize?.(msg.cols, msg.rows);
		return true;
	}
	if (msg.type === 'selection') {
		resolveSelection?.(msg.requestId, msg.text);
		return true;
	}
	if (msg.type === 'selectionChanged') {
		onSelection?.(msg.text);
		return true;
	}
	if (msg.type === 'selectionModeChanged') {
		onSelectionModeChange?.(msg.enabled);
		return true;
	}
	if (msg.type === 'scrollbackModeChanged') {
		onScrollbackModeChange?.({
			active: msg.active,
			phase: msg.phase,
			instanceId: msg.instanceId,
			requestId: msg.requestId,
		});
		return true;
	}
	if (msg.type === 'tmuxEnterCopyMode') {
		onTmuxEnterCopyMode?.({
			instanceId: msg.instanceId,
			requestId: msg.requestId,
		});
		return true;
	}
	if (msg.type === 'tmuxScrollBatch') {
		onTmuxScrollBatch?.({
			direction: msg.direction,
			pages: msg.pages,
			lines: msg.lines,
			pageStep: msg.pageStep,
			instanceId: msg.instanceId,
			seq: msg.seq,
			ts: msg.ts,
		});
		return true;
	}
	onUnhandled?.();
	return false;
}
