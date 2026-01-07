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
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
	type TouchScrollConfig,
} from './bridge';
import { jetBrainsMonoTtfBase64 } from './jetbrains-mono';

export { bStrToBinary, binaryToBStr };
export type { TouchScrollConfig };

let didLogHtmlFingerprint = false;
if (__DEV__ && !didLogHtmlFingerprint) {
	didLogHtmlFingerprint = true;
	try {
		console.log(
			`[xtermjs-webview] htmlString includes light blue lollipop: ${htmlString.includes(
				'#60a5fa',
			)}`,
		);
	} catch {
		// Ignore fingerprint logging failures
	}
}

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

/**
 * Message from this pkg to calling RN
 */
export type XtermInbound =
	| { type: 'initialized' }
	| { type: 'data'; data: Uint8Array }
	| { type: 'debug'; message: string }
	| { type: 'selectionChanged'; text: string }
	| { type: 'selectionModeChanged'; enabled: boolean };

export type XtermWebViewHandle = {
	write: (data: Uint8Array) => void; // bytes in (batched)
	// Efficiently write many chunks in one postMessage (for initial replay)
	writeMany: (chunks: Uint8Array[]) => void;
	flush: () => void; // force-flush outgoing writes
	clear: () => void;
	focus: () => void;
	setSystemKeyboardEnabled: (enabled: boolean) => void;
	setSelectionModeEnabled: (enabled: boolean) => void;
	getSelection: () => Promise<string>;
	resize: (size: { cols: number; rows: number }) => void;
	fit: () => void;
	exitScrollback: (opts?: { emitExit?: boolean; requestId?: number }) => void;
	sendTmuxEnterCopyModeAck: (requestId: number, instanceId: string) => void;
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

const defaultXtermOptions: Partial<ITerminalOptions> = {
	allowProposedApi: true,
	convertEol: true,
	scrollback: 10000,
	cursorBlink: true,
	// Tablet focus-mode defaults (JetBrains Mono preferred).
	// Note: WebView must have the font available or it will fall back.
	fontFamily:
		'"JetBrains Mono", "Roboto Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", monospace',
	fontSize: 16,
};

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
		kind: 'typing' | 'scroll';
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
	onTmuxEnterCopyMode,
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
	const pendingSelectionRef = useRef(
		new Map<number, { resolve: (value: string) => void }>(),
	);
	const currentInstanceIdRef = useRef<string | null>(null);

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
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			bufRef.current = null;
			pendingSelectionMap.clear();
		};
	}, []);

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
			pendingSelectionRef.current.set(requestId, { resolve });
			sendToWebView({ type: 'getSelection', requestId });
			// Timeout after 5s to prevent hanging if WebView is unresponsive
			setTimeout(() => {
				if (pendingSelectionRef.current.has(requestId)) {
					pendingSelectionRef.current.delete(requestId);
					resolve('');
				}
			}, 5000);
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

	useImperativeHandle(ref, () => ({
		write,
		writeMany,
		flush,
		clear: () => sendToWebView({ type: 'clear' }),
		focus: () => {
			sendToWebView({ type: 'focus' });
			webRef.current?.requestFocus();
		},
		setSystemKeyboardEnabled,
		setSelectionModeEnabled,
		getSelection,
		resize: (size: { cols: number; rows: number }) => {
			sendToWebView({ type: 'resize', cols: size.cols, rows: size.rows });
			autoFitFn();
			appliedSizeRef.current = size;
		},
		fit,
		exitScrollback: (opts) => {
			sendToWebView({ type: 'exitScrollback', ...opts });
		},
		sendTmuxEnterCopyModeAck: (requestId, instanceId) => {
			sendToWebView({
				type: 'tmuxEnterCopyModeAck',
				requestId,
				instanceId,
			});
		},
	}));

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

	const onMessage = useCallback(
		(e: WebViewMessageEvent) => {
			try {
				const msg: BridgeInboundMessage = JSON.parse(e.nativeEvent.data);
				logger?.log?.(`received msg from webview: `, msg);
				if (msg.type === 'initialized') {
					currentInstanceIdRef.current = msg.instanceId;
					pendingSelectionRef.current.clear();
					onInitialized?.(msg.instanceId);
					autoFitFn();
					setInitialized(true);
					return;
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
					return;
				}
				if (msg.type === 'input') {
					const kind = msg.kind ?? 'typing';
					onInput?.({ str: msg.str, kind, instanceId: msg.instanceId });
					if (kind === 'typing') {
						// const bytes = bStrToBinary(msg.bStr);
						// onData?.(bytes);
						onData?.(msg.str);
					}
					return;
				}
				if (msg.type === 'debug') {
					logger?.log?.(`received debug msg from webview: `, msg.message);
					return;
				}
				if (msg.type === 'sizeChanged') {
					logger?.log?.(`terminal size changed: ${msg.cols}x${msg.rows}`);
					onResize?.(msg.cols, msg.rows);
					return;
				}
				if (msg.type === 'selection') {
					const pending = pendingSelectionRef.current.get(msg.requestId);
					if (pending) {
						pendingSelectionRef.current.delete(msg.requestId);
						pending.resolve(msg.text);
					}
					return;
				}
				if (msg.type === 'selectionChanged') {
					onSelection?.(msg.text);
					return;
				}
				if (msg.type === 'selectionModeChanged') {
					onSelectionModeChange?.(msg.enabled);
					return;
				}
				if (msg.type === 'scrollbackModeChanged') {
					onScrollbackModeChange?.({
						active: msg.active,
						phase: msg.phase,
						instanceId: msg.instanceId,
						requestId: msg.requestId,
					});
					return;
				}
				if (msg.type === 'tmuxEnterCopyMode') {
					onTmuxEnterCopyMode?.({
						instanceId: msg.instanceId,
						requestId: msg.requestId,
					});
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
			onTmuxEnterCopyMode,
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

	const mergedWebViewOptions = useMemo(
		() => ({
			...defaultWebViewProps,
			...webViewOptions,
			onContentProcessDidTerminate,
			onRenderProcessGone,
			onLoadEnd,
		}),
		[
			webViewOptions,
			onContentProcessDidTerminate,
			onRenderProcessGone,
			onLoadEnd,
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
				${backgroundScript}
			})();
			true;
		`;
	}, [mergedXTermOptions]);

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
