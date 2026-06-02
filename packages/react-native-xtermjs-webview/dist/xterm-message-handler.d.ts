import { BridgeInboundMessage, TmuxScrollBatchEvent } from './bridge';
type PendingSelectionRef = {
    current: Map<number, {
        resolve: (value: string) => void;
    }>;
};
type XtermMessageLogger = {
    log?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
};
export declare function handleXtermBridgeInboundMessage(msg: BridgeInboundMessage, { currentInstanceIdRef, pendingSelectionRef, logger, onInitialized, autoFitFn, setInitialized, onInput, onData, onResize, onSelection, onSelectionModeChange, onScrollbackModeChange, onScrollbackEnterRequested, onTmuxScrollBatch, }: {
    currentInstanceIdRef: {
        current: string | null;
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
    onScrollbackEnterRequested?: (event: {
        instanceId: string;
        requestId: number;
    }) => void;
    onTmuxScrollBatch?: (event: TmuxScrollBatchEvent) => void;
}): boolean;
export {};
//# sourceMappingURL=xterm-message-handler.d.ts.map