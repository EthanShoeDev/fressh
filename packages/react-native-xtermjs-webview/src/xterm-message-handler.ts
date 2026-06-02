import {
	handleScrollbackBatchBridgeMessage,
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
	type ScrollbackBatchEvent,
} from './bridge';

type PendingSelectionRef = {
	current: Map<number, { resolve: (value: string) => void }>;
};

type XtermMessageLogger = {
	log?: (...args: unknown[]) => void;
	warn?: (...args: unknown[]) => void;
};

export function handleXtermBridgeInboundMessage(
	msg: BridgeInboundMessage,
	{
		currentInstanceIdRef,
		pendingSelectionRef,
		logger,
		onInitialized,
		autoFitFn,
		setInitialized,
		onInput,
		onData,
		onResize,
		onSelection,
		onSelectionModeChange,
		onScrollbackModeChange,
		onScrollbackEnterRequested,
		onScrollbackEnterRequestFailure,
		onScrollbackBatch,
	}: {
		currentInstanceIdRef: { current: string | null };
		pendingSelectionRef: PendingSelectionRef;
		logger?: XtermMessageLogger;
		onInitialized?: (instanceId: string) => void;
		autoFitFn: () => void;
		setInitialized: (initialized: boolean) => void;
		onInput?: (input: {
			str: string;
			kind: 'typing';
			instanceId: string;
		}) => void;
		onData?: (data: string) => void;
		onResize?: (cols: number, rows: number) => void;
		onSelection?: (text: string) => void;
		onSelectionModeChange?: (enabled: boolean) => void;
		onScrollbackModeChange?: (event: {
			active: boolean;
			phase: 'dragging' | 'active';
			instanceId: string;
			requestId?: number;
		}) => void;
		onScrollbackEnterRequested?: (event: {
			instanceId: string;
			requestId: number;
		}) => void | Promise<void>;
		onScrollbackEnterRequestFailure?: (
			event: { instanceId: string; requestId: number },
			error: unknown,
		) => void;
		onScrollbackBatch?: (event: ScrollbackBatchEvent) => void;
	},
): boolean {
	if (msg.type === 'initialized') {
		currentInstanceIdRef.current = msg.instanceId;
		pendingSelectionRef.current.clear();
		onInitialized?.(msg.instanceId);
		autoFitFn();
		setInitialized(true);
		return true;
	}
	if (
		'instanceId' in msg &&
		currentInstanceIdRef.current &&
		msg.instanceId !== currentInstanceIdRef.current
	) {
		logger?.warn?.(
			`dropping stale webview message`,
			msg.type,
			msg.instanceId,
		);
		return true;
	}
	if (msg.type === 'input') {
		const kind = msg.kind ?? 'typing';
		onInput?.({ str: msg.str, kind, instanceId: msg.instanceId });
		onData?.(msg.str);
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
		const pending = pendingSelectionRef.current.get(msg.requestId);
		if (pending) {
			pendingSelectionRef.current.delete(msg.requestId);
			pending.resolve(msg.text);
		}
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
	if (msg.type === 'scrollbackEnterRequested') {
		const event = {
			instanceId: msg.instanceId,
			requestId: msg.requestId,
		};
		void Promise.resolve(onScrollbackEnterRequested?.(event)).catch((error) => {
			onScrollbackEnterRequestFailure?.(event, error);
		});
		return true;
	}
	return handleScrollbackBatchBridgeMessage(msg, onScrollbackBatch);
}

export function buildScrollbackEnterRequestFailureMessage(event: {
	requestId: number;
}): BridgeOutboundMessage {
	return {
		type: 'exitScrollback',
		requestId: event.requestId,
	};
}
