type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type ITerminalInitOnlyOptions = import('@xterm/xterm').ITerminalInitOnlyOptions;
type BridgeLoad = {
    bridgeLoadId: number;
};
type BridgeGeneration = BridgeLoad & {
    bridgeLoadToken: string;
};
type LegacyBridgeGeneration = {
    bridgeStartedAt?: number;
};
export type BridgeInboundMessage = ({
    type: 'documentStarted';
    bridgeLoadToken: string;
} & BridgeLoad) | ({
    type: 'initialized';
    instanceId: string;
} & BridgeGeneration) | {
    type: 'input';
    str: string;
    instanceId: string;
    kind?: 'typing';
} & BridgeGeneration | {
    type: 'debug';
    message: string;
} | ({
    type: 'sizeChanged';
    cols: number;
    rows: number;
    instanceId: string;
} & BridgeGeneration) | ({
    type: 'selection';
    requestId: number;
    text: string;
    instanceId: string;
} & BridgeGeneration) | ({
    type: 'selectionChanged';
    text: string;
    instanceId: string;
} & BridgeGeneration) | ({
    type: 'selectionModeChanged';
    enabled: boolean;
    instanceId: string;
} & BridgeGeneration) | {
    type: 'scrollbackModeChanged';
    active: boolean;
    phase: 'dragging' | 'active';
    instanceId: string;
    requestId?: number;
} & BridgeGeneration | ({
    type: 'scrollbackEnterRequested';
    instanceId: string;
    requestId: number;
} & BridgeGeneration) | ({
    type: 'tmuxEnterCopyMode';
    instanceId: string;
    requestId: number;
} & BridgeGeneration) | {
    type: 'scrollbackBatch';
    direction: 'up' | 'down';
    pages: number;
    lines: number;
    pageStep: number;
    instanceId: string;
    seq?: number;
    ts?: number;
} & BridgeGeneration | {
    type: 'tmuxScrollBatch';
    direction: 'up' | 'down';
    pages: number;
    lines: number;
    pageStep?: number;
    instanceId: string;
    seq?: number;
    ts?: number;
} & BridgeGeneration;
type WithOptionalBridgeGeneration<T> = T extends BridgeGeneration ? Omit<T, keyof BridgeGeneration> & Partial<BridgeGeneration> & LegacyBridgeGeneration : T extends BridgeLoad ? Omit<T, keyof BridgeLoad> & Partial<BridgeLoad> : T;
export type BridgeInboundDraftMessage = WithOptionalBridgeGeneration<BridgeInboundMessage>;
export type ScrollbackBatchBridgeMessage = Extract<BridgeInboundDraftMessage, {
    type: 'scrollbackBatch' | 'tmuxScrollBatch';
}>;
export type ScrollbackBatchEvent = {
    direction: 'up' | 'down';
    pages: number;
    lines: number;
    pageStep: number;
    instanceId: string;
    seq?: number;
    ts?: number;
};
export type TmuxScrollBatchEvent = Omit<Extract<BridgeInboundMessage, {
    type: 'tmuxScrollBatch';
}>, 'type'>;
export declare function mapScrollbackBatchMessage(msg: ScrollbackBatchBridgeMessage): ScrollbackBatchEvent;
export declare function handleScrollbackBatchBridgeMessage(msg: BridgeInboundDraftMessage, onScrollbackBatch?: (event: ScrollbackBatchEvent) => void): msg is ScrollbackBatchBridgeMessage;
export type TouchScrollConfig = {
    enabled: false;
} | {
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
    instanceId?: string;
    emitExit?: boolean;
} | {
    type: 'scrollbackEnterAck';
    requestId: number;
    instanceId: string;
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