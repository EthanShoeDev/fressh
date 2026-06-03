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

type ScrollbackEnterRequestEvent = {
	instanceId: string;
	requestId: number;
};

function reportScrollbackEnterRequestFailure({
	event,
	error,
	onScrollbackEnterRequestFailure,
}: {
	event: ScrollbackEnterRequestEvent;
	error: unknown;
	onScrollbackEnterRequestFailure?: (
		event: ScrollbackEnterRequestEvent,
		error: unknown,
	) => void;
}): void {
	try {
		onScrollbackEnterRequestFailure?.(event, error);
	} catch {
		// Failure fallback is best-effort; never rethrow into WebView message flow.
	}
}

export function createScrollbackEnterRequestFailureHandler({
	logger,
	sendToWebView,
}: {
	logger?: XtermMessageLogger;
	sendToWebView: (message: BridgeOutboundMessage) => void;
}): (event: ScrollbackEnterRequestEvent, error: unknown) => void {
	return (event, error) => {
		logger?.warn?.(
			`scrollback enter request failed`,
			event.instanceId,
			event.requestId,
			error,
		);
		sendToWebView({
			...buildScrollbackEnterRequestFailureMessage(event),
		});
	};
}

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
		invalidatedInstanceIdsRef,
		lastLoadStartAtRef,
	}: {
		currentInstanceIdRef: { current: string | null };
		invalidatedInstanceIdsRef?: { current: Set<string> };
		lastLoadStartAtRef?: { current: number };
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
		onScrollbackEnterRequested?: (
			event: ScrollbackEnterRequestEvent,
		) => void | Promise<void>;
		onScrollbackEnterRequestFailure?: (
			event: ScrollbackEnterRequestEvent,
			error: unknown,
		) => void;
		onScrollbackBatch?: (event: ScrollbackBatchEvent) => void;
	},
): boolean {
	if (msg.type === 'initialized') {
		const lastLoadStartAt = lastLoadStartAtRef?.current ?? 0;
		if (
			lastLoadStartAt > 0 &&
			(typeof msg.bridgeStartedAt !== 'number' ||
				msg.bridgeStartedAt < lastLoadStartAt)
		) {
			logger?.warn?.(
				`dropping stale webview initialized generation`,
				msg.instanceId,
			);
			return true;
		}
		if (invalidatedInstanceIdsRef?.current.has(msg.instanceId)) {
			logger?.warn?.(
				`dropping invalidated webview initialized message`,
				msg.instanceId,
			);
			return true;
		}
		if (
			currentInstanceIdRef.current &&
			msg.instanceId !== currentInstanceIdRef.current
		) {
			logger?.warn?.(
				`dropping stale webview initialized message`,
				msg.instanceId,
			);
			return true;
		}
		currentInstanceIdRef.current = msg.instanceId;
		invalidatedInstanceIdsRef?.current.clear();
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
		if (kind === 'typing') {
			onInput?.({ str: msg.str, kind, instanceId: msg.instanceId });
			onData?.(msg.str);
		} else {
			logger?.warn?.(`dropping non-typing webview input`, kind);
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
	if (
		msg.type === 'scrollbackEnterRequested' ||
		msg.type === 'tmuxEnterCopyMode'
	) {
		const event = {
			instanceId: msg.instanceId,
			requestId: msg.requestId,
		};
		if (!onScrollbackEnterRequested) {
			reportScrollbackEnterRequestFailure({
				event,
				error: new Error('Missing scrollback enter handler.'),
				onScrollbackEnterRequestFailure,
			});
			return true;
		}
		try {
			void Promise.resolve(onScrollbackEnterRequested(event)).catch((error) => {
				reportScrollbackEnterRequestFailure({
					event,
					error,
					onScrollbackEnterRequestFailure,
				});
			});
		} catch (error) {
			reportScrollbackEnterRequestFailure({
				event,
				error,
				onScrollbackEnterRequestFailure,
			});
		}
		return true;
	}
	return handleScrollbackBatchBridgeMessage(msg, onScrollbackBatch);
}

function buildScrollbackEnterRequestFailureMessage(event: {
	instanceId: string;
	requestId: number;
}): BridgeOutboundMessage {
	return {
		type: 'exitScrollback',
		requestId: event.requestId,
		instanceId: event.instanceId,
	};
}
