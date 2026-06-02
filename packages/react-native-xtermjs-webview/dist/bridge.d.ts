type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type ITerminalInitOnlyOptions = import('@xterm/xterm').ITerminalInitOnlyOptions;
export type BridgeInboundMessage = {
    type: 'initialized';
    instanceId: string;
} | {
    type: 'input';
    str: string;
    instanceId: string;
    kind?: 'typing';
} | {
    type: 'debug';
    message: string;
} | {
    type: 'sizeChanged';
    cols: number;
    rows: number;
} | {
    type: 'selection';
    requestId: number;
    text: string;
    instanceId: string;
} | {
    type: 'selectionChanged';
    text: string;
    instanceId: string;
} | {
    type: 'selectionModeChanged';
    enabled: boolean;
    instanceId: string;
} | {
    type: 'scrollbackModeChanged';
    active: boolean;
    phase: 'dragging' | 'active';
    instanceId: string;
    requestId?: number;
} | {
    type: 'tmuxEnterCopyMode';
    instanceId: string;
    requestId: number;
} | {
    type: 'tmuxScrollBatch';
    direction: 'up' | 'down';
    pages: number;
    lines: number;
    pageStep: number;
    instanceId: string;
    seq?: number;
    ts?: number;
};
export type TouchScrollConfig = {
    enabled: false;
} | {
    enabled: true;
    pxPerLine?: number;
    slopPx?: number;
    maxLinesPerFrame?: number;
    flickVelocity?: number;
    invertScroll?: boolean;
    enterDelayMs?: number;
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
export type BridgeOutboundMessage = {
    type: 'write';
    bStr: string;
} | {
    type: 'writeMany';
    chunks: string[];
} | {
    type: 'resize';
    cols: number;
    rows: number;
} | {
    type: 'fit';
} | {
    type: 'getSelection';
    requestId: number;
} | {
    type: 'setSelectionMode';
    enabled: boolean;
} | {
    type: 'setTouchScrollConfig';
    config: TouchScrollConfig;
} | {
    type: 'exitScrollback';
    requestId?: number;
} | {
    type: 'tmuxEnterCopyModeAck';
    requestId: number;
    instanceId: string;
} | {
    type: 'setOptions';
    opts: Partial<Omit<ITerminalOptions, keyof ITerminalInitOnlyOptions>>;
} | {
    type: 'clear';
} | {
    type: 'focus';
};
export declare const binaryToBStr: (binary: Uint8Array) => string;
export declare const bStrToBinary: (bStr: string) => Uint8Array;
export {};
//# sourceMappingURL=bridge.d.ts.map