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
export declare function handleXtermJsWebViewMessage({ rawData, currentInstanceId, setCurrentInstanceId, clearPendingSelections, resolveSelection, onInitialized, onAutoFit, onSetInitialized, onData, onInput, onResize, onSelection, onSelectionModeChange, onScrollbackModeChange, onTmuxEnterCopyMode, onTmuxScrollBatch, onUnhandled, logger, }: XtermJsWebViewMessageHandlerOptions): boolean;
//# sourceMappingURL=message-handler.d.ts.map