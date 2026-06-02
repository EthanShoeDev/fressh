import { default as React, RefObject } from 'react';
import { WebView } from 'react-native-webview';
import { binaryToBStr, bStrToBinary, TmuxScrollBatchEvent, TouchScrollConfig } from './bridge';
export { bStrToBinary, binaryToBStr };
export type { TouchScrollConfig };
type StrictOmit<T, K extends keyof T> = Omit<T, K>;
type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type WebViewOptions = React.ComponentProps<typeof WebView>;
/**
 * Message from this pkg to calling RN
 */
export type XtermInbound = {
    type: 'initialized';
} | {
    type: 'data';
    data: Uint8Array;
} | {
    type: 'debug';
    message: string;
} | {
    type: 'selectionChanged';
    text: string;
} | {
    type: 'selectionModeChanged';
    enabled: boolean;
};
export type XtermWebViewHandle = {
    write: (data: Uint8Array) => void;
    writeMany: (chunks: Uint8Array[]) => void;
    flush: () => void;
    clear: () => void;
    focus: () => void;
    setSystemKeyboardEnabled: (enabled: boolean) => void;
    setSelectionModeEnabled: (enabled: boolean) => void;
    getSelection: () => Promise<string>;
    resize: (size: {
        cols: number;
        rows: number;
    }) => void;
    fit: () => void;
    exitScrollback: (opts?: {
        requestId?: number;
    }) => void;
    sendTmuxEnterCopyModeAck: (requestId: number, instanceId: string) => void;
};
type UserControllableWebViewProps = StrictOmit<WebViewOptions, 'source' | 'style' | 'injectedJavaScriptBeforeContentLoaded'>;
export type XtermJsWebViewProps = {
    ref: RefObject<XtermWebViewHandle | null>;
    style?: WebViewOptions['style'];
    webViewOptions?: UserControllableWebViewProps;
    xtermOptions?: Partial<ITerminalOptions>;
    /** Dev-only override for loading the internal WebView HTML via a Vite dev server. */
    devServerUrl?: string;
    onInitialized?: (instanceId: string) => void;
    onData?: (data: string) => void;
    onInput?: (input: {
        str: string;
        kind: 'typing';
        instanceId: string;
    }) => void;
    onSelection?: (text: string) => void;
    onSelectionModeChange?: (enabled: boolean) => void;
    /** Called when terminal size changes (cols/rows). Use for PTY resize. */
    onResize?: (cols: number, rows: number) => void;
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
    onTmuxScrollBatch?: (event: TmuxScrollBatchEvent) => void;
    logger?: {
        debug?: (...args: unknown[]) => void;
        log?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
    };
    coalescingThreshold?: number;
    size?: {
        cols: number;
        rows: number;
    };
    autoFit?: boolean;
    touchScrollConfig?: TouchScrollConfig;
};
export declare function XtermJsWebView({ ref, style, webViewOptions, xtermOptions, onInitialized, onData, onInput, onSelection, onSelectionModeChange, onResize, onScrollbackModeChange, onTmuxEnterCopyMode, onTmuxScrollBatch, coalescingThreshold, logger, size, autoFit, devServerUrl, touchScrollConfig, }: XtermJsWebViewProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=index.d.ts.map