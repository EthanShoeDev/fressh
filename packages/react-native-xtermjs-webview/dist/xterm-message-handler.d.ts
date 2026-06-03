import { BridgeInboundDraftMessage, BridgeOutboundMessage, ScrollbackBatchEvent } from './bridge';
type PendingSelectionRef = {
    current: Map<number, {
        resolve: (value: string) => void;
    }>;
};
type XtermMessageLogger = {
    log?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
};
type ScrollbackEnterRequestEvent = {
    instanceId: string;
    requestId: number;
};
export declare function createScrollbackEnterRequestFailureHandler({ logger, sendToWebView, }: {
    logger?: XtermMessageLogger;
    sendToWebView: (message: BridgeOutboundMessage) => void;
}): (event: ScrollbackEnterRequestEvent, error: unknown) => void;
export declare function handleXtermBridgeInboundMessage(msg: BridgeInboundDraftMessage, { currentInstanceIdRef, pendingSelectionRef, logger, onInitialized, autoFitFn, setInitialized, onInput, onData, onResize, onSelection, onSelectionModeChange, onScrollbackModeChange, onScrollbackEnterRequested, onScrollbackEnterRequestFailure, onScrollbackBatch, invalidatedInstanceIdsRef, currentBridgeLoadTokenRef, awaitingBridgeDocumentStartRef, }: {
    currentInstanceIdRef: {
        current: string | null;
    };
    invalidatedInstanceIdsRef?: {
        current: Set<string>;
    };
    currentBridgeLoadTokenRef?: {
        current: string | null;
    };
    awaitingBridgeDocumentStartRef?: {
        current: boolean;
    };
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
    onScrollbackEnterRequested?: (event: ScrollbackEnterRequestEvent) => void | Promise<void>;
    onScrollbackEnterRequestFailure?: (event: ScrollbackEnterRequestEvent, error: unknown) => void;
    onScrollbackBatch?: (event: ScrollbackBatchEvent) => void;
}): boolean;
export {};
//# sourceMappingURL=xterm-message-handler.d.ts.map