import React, {
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useCallback,
	useState,
	type RefObject,
} from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import htmlString from '../dist-internal/index.html?raw';

// React Native global for development mode detection
declare const __DEV__: boolean | undefined;
import {
	binaryToBStr,
	bStrToBinary,
	type BridgeInboundDraftMessage,
	type BridgeOutboundMessage,
	type ScrollbackBatchEvent,
	type TouchScrollConfig,
	type TmuxScrollBatchEvent,
} from './bridge';
import { jetBrainsMonoTtfBase64 } from './jetbrains-mono';
import { createDefaultXtermOptions } from './terminal-options';
import {
	createScrollbackEnterRequestFailureHandler,
	handleXtermBridgeInboundMessage,
} from './xterm-message-handler';
import {
	createXtermWebViewAckSenders,
	createXtermWebViewHandle,
	type XtermWebViewHandle,
} from './xterm-webview-handle';

export { bStrToBinary, binaryToBStr };
export type {
	ScrollbackBatchEvent,
	TmuxScrollBatchEvent,
	TouchScrollConfig,
	XtermWebViewHandle,
};

type StrictOmit<T, K extends keyof T> = Omit<T, K>;
type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type WebViewOptions = React.ComponentProps<typeof WebView>;

const defaultCoalescingThreshold = 8 * 1024;
const jetBrainsMonoStyleId = 'fressh-jetbrains-mono';
const jetBrainsMonoFontCss = `
@font-face {
	font-family: 'JetBrains Mono';
	src: url(data:font/ttf;base64,${jetBrainsMonoTtfBase64}) format('truetype');
	font-weight: 400;
	font-style: normal;
	font-display: swap;
}
`;

type LegacyXtermInbound =
	| { type: 'initialized' }
	| { type: 'data'; data: Uint8Array }
	| { type: 'debug'; message: string }
	| { type: 'selectionChanged'; text: string }
	| { type: 'selectionModeChanged'; enabled: boolean };

export type XtermInbound = BridgeInboundDraftMessage | LegacyXtermInbound;

type PendingSelection = {
	resolve: (value: string) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
};

const defaultWebViewProps: WebViewOptions = {
	// WebView behavior that suits terminals
	// ios
	keyboardDisplayRequiresUserAction: false,
	pullToRefreshEnabled: false,
	bounces: false,
	textInteractionEnabled: false,
	allowsLinkPreview: false,
	// android
	setSupportMultipleWindows: false,
	overScrollMode: 'never',
	setBuiltInZoomControls: false,
	setDisplayZoomControls: false,
	textZoom: 100,
	// both
	originWhitelist: ['*'],
	scalesPageToFit: false,
	contentMode: 'mobile',
};
const touchScrollWebViewProps: WebViewOptions = {
	scrollEnabled: false,
	nestedScrollEnabled: false,
	showsVerticalScrollIndicator: false,
	showsHorizontalScrollIndicator: false,
};

const defaultXtermOptions = createDefaultXtermOptions();

type UserControllableWebViewProps = StrictOmit<
	WebViewOptions,
	'source' | 'style' | 'injectedJavaScriptBeforeContentLoaded'
>;

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
	onScrollbackEnterRequested?: (event: {
		instanceId: string;
		requestId: number;
	}) => void;
	onScrollbackBatch?: (event: ScrollbackBatchEvent) => void;
	onTmuxEnterCopyMode?: (event: {
		instanceId: string;
		requestId: number;
	}) => void;
	onTmuxScrollBatch?: (event: ScrollbackBatchEvent) => void;
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

function xTermOptionsEquals(
	a: Partial<ITerminalOptions> | null,
	b: Partial<ITerminalOptions> | null,
): boolean {
	if (a == b) return true;
	if (a == null && b == null) return true;
	if (a == null || b == null) return false;
	const keys = new Set<string>([
		...Object.keys(a as object),
		...Object.keys(b as object),
	]);
	for (const k of keys) {
		const key = k as keyof ITerminalOptions;
		if (a[key] !== b[key]) return false;
	}
	return true;
}

function touchScrollConfigEquals(
	a: TouchScrollConfig | null | undefined,
	b: TouchScrollConfig | null | undefined,
): boolean {
	if (a == b) return true;
	if (a == null && b == null) return true;
	if (a == null || b == null) return false;
	const keys = new Set<string>([
		...Object.keys(a as object),
		...Object.keys(b as object),
	]);
	for (const key of keys) {
		if (a[key as keyof TouchScrollConfig] !== b[key as keyof TouchScrollConfig])
			return false;
	}
	return true;
}

function resolvePendingSelections(
	pendingSelectionMap: Map<number, PendingSelection>,
): void {
	for (const pending of pendingSelectionMap.values()) {
		if (pending.timeoutId) clearTimeout(pending.timeoutId);
		pending.resolve('');
	}
	pendingSelectionMap.clear();
}

function resolvePendingSelection(
	pendingSelectionMap: Map<number, PendingSelection>,
	requestId: number,
	value: string,
): void {
	const pending = pendingSelectionMap.get(requestId);
	if (!pending) return;
	pendingSelectionMap.delete(requestId);
	if (pending.timeoutId) clearTimeout(pending.timeoutId);
	pending.resolve(value);
}

export function XtermJsWebView({
	ref,
	style,
	webViewOptions = defaultWebViewProps,
	xtermOptions = defaultXtermOptions,
	onInitialized,
	onData,
	onInput,
	onSelection,
	onSelectionModeChange,
	onResize,
	onScrollbackModeChange,
	onScrollbackEnterRequested,
	onScrollbackBatch,
	onTmuxEnterCopyMode,
	onTmuxScrollBatch,
	coalescingThreshold = defaultCoalescingThreshold,
	logger,
	size,
	autoFit = true,
	devServerUrl,
	touchScrollConfig,
}: XtermJsWebViewProps) {
	const webRef = useRef<WebView>(null);
	const [initialized, setInitialized] = useState(false);
	const selectionRequestIdRef = useRef(0);
	const pendingSelectionRef = useRef(new Map<number, PendingSelection>());
	const currentInstanceIdRef = useRef<string | null>(null);
	const invalidatedInstanceIdsRef = useRef(new Set<string>());
	const invalidatedBridgeLoadTokensRef = useRef(new Set<string>());
	const [bridgeLoadId, setBridgeLoadId] = useState(1);
	const expectedBridgeLoadIdRef = useRef(1);
	const remountingForBridgeLoadRef = useRef(false);
	const currentBridgeLoadTokenRef = useRef<string | null>(null);
	const awaitingBridgeDocumentStartRef = useRef(false);

	// ---- RN -> WebView message sender
	const sendToWebView = useCallback(
		(obj: BridgeOutboundMessage) => {
			const webViewRef = webRef.current;
			if (!webViewRef) return;
			const payload = JSON.stringify(obj);
			logger?.debug?.(`sending msg to webview: ${payload}`);
			const js = `window.dispatchEvent(new MessageEvent('message',{data:${payload}})); true;`;
			webViewRef.injectJavaScript(js);
		},
		[logger],
	);

	// ---- rAF + 8KB coalescer for writes
	const bufRef = useRef<Uint8Array | null>(null);
	const rafRef = useRef<number | null>(null);

	const flush = useCallback(() => {
		if (!bufRef.current) return;
		const bStr = binaryToBStr(bufRef.current);
		bufRef.current = null;
		if (rafRef.current != null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		sendToWebView({ type: 'write', bStr });
	}, [sendToWebView]);

	const cancelPendingWrite = useCallback(() => {
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		bufRef.current = null;
	}, []);

	const schedule = useCallback(() => {
		if (rafRef.current != null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			flush();
		});
	}, [flush]);

	const write = useCallback(
		(data: Uint8Array) => {
			if (!data || data.length === 0) return;
			if (!bufRef.current) {
				bufRef.current = data;
			} else {
				const a = bufRef.current;
				const merged = new Uint8Array(a.length + data.length);
				merged.set(a, 0);
				merged.set(data, a.length);
				bufRef.current = merged;
			}
			if ((bufRef.current?.length ?? 0) >= coalescingThreshold) flush();
			else schedule();
		},
		[coalescingThreshold, flush, schedule],
	);

	const writeMany = useCallback(
		(chunks: Uint8Array[]) => {
			if (!chunks || chunks.length === 0) return;
			flush(); // Ensure any pending small buffered write is flushed before bulk write
			const bStrs = chunks.map(binaryToBStr);
			sendToWebView({ type: 'writeMany', chunks: bStrs });
		},
		[flush, sendToWebView],
	);

	// Cleanup pending rAF on unmount
	useEffect(() => {
		const pendingSelectionMap = pendingSelectionRef.current;
		return () => {
			cancelPendingWrite();
			resolvePendingSelections(pendingSelectionMap);
		};
	}, [cancelPendingWrite]);

	const fit = useCallback(() => {
		sendToWebView({ type: 'fit' });
	}, [sendToWebView]);

	const setSystemKeyboardEnabled = useCallback((enabled: boolean) => {
		const webViewRef = webRef.current;
		if (!webViewRef) return;
		const js = `
(() => {
	const ta = document.querySelector('.xterm-helper-textarea');
	if (!ta) return true;
	ta.setAttribute('inputmode', ${enabled ? "'verbatim'" : "'none'"});
	ta.tabIndex = ${enabled ? 0 : -1};
	if (${enabled ? 'true' : 'false'}) {
		ta.removeAttribute('readonly');
		ta.focus();
	} else {
		ta.setAttribute('readonly', 'true');
		ta.blur();
	}
	return true;
})();`;
		webViewRef.injectJavaScript(js);
		if (enabled) {
			webViewRef.requestFocus();
		}
	}, []);

	const getSelection = useCallback((): Promise<string> => {
		if (!initialized) return Promise.resolve('');
		const requestId = selectionRequestIdRef.current + 1;
		selectionRequestIdRef.current = requestId;
		return new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				resolvePendingSelection(pendingSelectionRef.current, requestId, '');
			}, 5000);
			pendingSelectionRef.current.set(requestId, { resolve, timeoutId });
			sendToWebView({ type: 'getSelection', requestId });
		});
	}, [initialized, sendToWebView]);

	const setSelectionModeEnabled = useCallback(
		(enabled: boolean) => {
			sendToWebView({ type: 'setSelectionMode', enabled });
		},
		[sendToWebView],
	);

	const autoFitFn = useCallback(() => {
		if (!autoFit) return;
		fit();
	}, [autoFit, fit]);

	const appliedSizeRef = useRef<{ cols: number; rows: number } | null>(null);

	useEffect(() => {
		if (!initialized) return;
		const appliedSize = appliedSizeRef.current;
		if (!size) return;
		if (appliedSize?.cols === size.cols && appliedSize?.rows === size.rows)
			return;

		logger?.log?.(`calling resize`, size);
		sendToWebView({ type: 'resize', cols: size.cols, rows: size.rows });
		autoFitFn();

		appliedSizeRef.current = size;
	}, [size, sendToWebView, logger, autoFitFn, initialized]);

	const ackSenders = useMemo(
		() => createXtermWebViewAckSenders(sendToWebView),
		[sendToWebView],
	);

	useImperativeHandle(ref, () =>
		createXtermWebViewHandle({
			write,
			writeMany,
			flush,
			sendToWebView,
			webRef,
			setSystemKeyboardEnabled,
			setSelectionModeEnabled,
			getSelection,
			autoFitFn,
			appliedSizeRef,
			fit,
			...ackSenders,
		}),
	);

	const mergedXTermOptions = useMemo(
		() => ({
			...defaultXtermOptions,
			...xtermOptions,
		}),
		[xtermOptions],
	);

	const appliedXtermOptionsRef = useRef<Partial<ITerminalOptions> | null>(null);
	const appliedTouchConfigRef = useRef<TouchScrollConfig | null>(null);

	useEffect(() => {
		if (!initialized) return;
		const appliedXtermOptions = appliedXtermOptionsRef.current;
		if (xTermOptionsEquals(appliedXtermOptions, mergedXTermOptions)) return;
		logger?.log?.(`setting options: `, mergedXTermOptions);
		sendToWebView({ type: 'setOptions', opts: mergedXTermOptions });
		autoFitFn();

		appliedXtermOptionsRef.current = mergedXTermOptions;
	}, [mergedXTermOptions, sendToWebView, logger, initialized, autoFitFn]);

	useEffect(() => {
		if (!initialized) return;
		const normalizedConfig: TouchScrollConfig =
			touchScrollConfig ?? ({ enabled: false } as TouchScrollConfig);
		const appliedConfig = appliedTouchConfigRef.current;
		if (touchScrollConfigEquals(appliedConfig, normalizedConfig)) return;
		sendToWebView({ type: 'setTouchScrollConfig', config: normalizedConfig });
		appliedTouchConfigRef.current = normalizedConfig;
	}, [initialized, sendToWebView, touchScrollConfig]);

	const onScrollbackEnterRequestFailure = useMemo(
		() =>
			createScrollbackEnterRequestFailureHandler({
				logger,
				sendToWebView,
			}),
		[logger, sendToWebView],
	);
	const resolvedOnScrollbackEnterRequested =
		onScrollbackEnterRequested ?? onTmuxEnterCopyMode;
	const resolvedOnScrollbackBatch = onScrollbackBatch ?? onTmuxScrollBatch;

	const onMessage = useCallback(
		(e: WebViewMessageEvent) => {
			try {
				const msg = JSON.parse(e.nativeEvent.data) as BridgeInboundDraftMessage;
				logger?.log?.(`received msg from webview: `, msg);
				if (
					handleXtermBridgeInboundMessage(msg, {
						currentInstanceIdRef,
						invalidatedInstanceIdsRef,
						invalidatedBridgeLoadTokensRef,
						currentBridgeLoadTokenRef,
						expectedBridgeLoadIdRef,
						awaitingBridgeDocumentStartRef,
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
						onScrollbackEnterRequested: resolvedOnScrollbackEnterRequested,
						onScrollbackEnterRequestFailure,
						onScrollbackBatch: resolvedOnScrollbackBatch,
					})
				) {
					return;
				}
				webViewOptions?.onMessage?.(e);
			} catch (error) {
				logger?.warn?.(
					`received unknown msg from webview: `,
					e.nativeEvent.data,
					error,
				);
			}
		},
		[
			logger,
			webViewOptions,
			onInitialized,
			autoFitFn,
			onData,
			onInput,
			onResize,
			onSelection,
			onSelectionModeChange,
			onScrollbackModeChange,
			resolvedOnScrollbackEnterRequested,
			onScrollbackEnterRequestFailure,
			resolvedOnScrollbackBatch,
		],
	);

	const onContentProcessDidTerminate = useCallback<
		NonNullable<WebViewOptions['onContentProcessDidTerminate']>
	>(
		(e) => {
			logger?.warn?.('WebView Crashed on iOS! onContentProcessDidTerminate');
			webViewOptions?.onContentProcessDidTerminate?.(e);
		},
		[logger, webViewOptions],
	);

	const onRenderProcessGone = useCallback<
		NonNullable<WebViewOptions['onRenderProcessGone']>
	>(
		(e) => {
			logger?.warn?.('WebView Crashed on Android! onRenderProcessGone');
			webViewOptions?.onRenderProcessGone?.(e);
		},
		[logger, webViewOptions],
	);

	const onLoadEnd = useCallback<NonNullable<WebViewOptions['onLoadEnd']>>(
		(e) => {
			logger?.log?.('WebView onLoadEnd');
			webViewOptions?.onLoadEnd?.(e);
		},
		[logger, webViewOptions],
	);
	const touchScrollOwnsViewport = touchScrollConfig?.enabled === true;
	const onLoadStart = useCallback<NonNullable<WebViewOptions['onLoadStart']>>(
		(e) => {
			if (remountingForBridgeLoadRef.current) {
				remountingForBridgeLoadRef.current = false;
			} else {
				const nextBridgeLoadId = expectedBridgeLoadIdRef.current + 1;
				expectedBridgeLoadIdRef.current = nextBridgeLoadId;
				remountingForBridgeLoadRef.current = true;
				setBridgeLoadId(nextBridgeLoadId);
			}
			awaitingBridgeDocumentStartRef.current = true;
			if (currentBridgeLoadTokenRef.current) {
				invalidatedBridgeLoadTokensRef.current.add(
					currentBridgeLoadTokenRef.current,
				);
			}
			currentBridgeLoadTokenRef.current = null;
			if (currentInstanceIdRef.current) {
				invalidatedInstanceIdsRef.current.add(currentInstanceIdRef.current);
			}
			currentInstanceIdRef.current = null;
			appliedSizeRef.current = null;
			appliedXtermOptionsRef.current = null;
			appliedTouchConfigRef.current = null;
			cancelPendingWrite();
			resolvePendingSelections(pendingSelectionRef.current);
			setInitialized(false);
			webViewOptions?.onLoadStart?.(e);
		},
		[cancelPendingWrite, webViewOptions],
	);

	const mergedWebViewOptions = useMemo(
		() => ({
			...defaultWebViewProps,
			...webViewOptions,
			...(touchScrollOwnsViewport ? touchScrollWebViewProps : {}),
			onLoadStart,
			onContentProcessDidTerminate,
			onRenderProcessGone,
			onLoadEnd,
		}),
		[
			webViewOptions,
			onLoadStart,
			onContentProcessDidTerminate,
			onRenderProcessGone,
			onLoadEnd,
			touchScrollOwnsViewport,
		],
	);

	// Inject JetBrains Mono into the WebView document so xterm can use it reliably,
	// and set the background early to avoid white flashes.
	const injectedJavaScriptBeforeContentLoaded = useMemo(() => {
		const backgroundScript = mergedXTermOptions.theme?.background
			? `document.body.style.backgroundColor = '${mergedXTermOptions.theme.background}';`
			: '';
		const optionsScript = `window.__FRESSH_XTERM_OPTIONS__ = ${JSON.stringify(
			mergedXTermOptions,
		)};`;
		const bridgeLoadScript = `window.__FRESSH_XTERM_BRIDGE_LOAD_ID__ = ${JSON.stringify(
			bridgeLoadId,
		)};`;

		return `
			(function () {
				var styleId = '${jetBrainsMonoStyleId}';
				if (!document.getElementById(styleId)) {
					var style = document.createElement('style');
					style.id = styleId;
					style.type = 'text/css';
					style.textContent = ${JSON.stringify(jetBrainsMonoFontCss)};
					(document.head || document.documentElement).appendChild(style);
				}
				${optionsScript}
				${bridgeLoadScript}
				${backgroundScript}
			})();
			true;
		`;
	}, [bridgeLoadId, mergedXTermOptions]);

	const webViewSource = useMemo(() => {
		if (__DEV__ && devServerUrl) {
			const normalized =
				devServerUrl.startsWith('http://') ||
				devServerUrl.startsWith('https://')
					? devServerUrl
					: `http://${devServerUrl}`;
			return { uri: normalized };
		}
		return { html: htmlString };
	}, [devServerUrl]);

	return (
		<WebView
			key={bridgeLoadId}
			ref={webRef}
			source={webViewSource}
			onMessage={onMessage}
			style={style}
			injectedJavaScriptObject={mergedXTermOptions}
			injectedJavaScriptBeforeContentLoaded={
				injectedJavaScriptBeforeContentLoaded
			}
			{...mergedWebViewOptions}
		/>
	);
}
