import React, {
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useCallback,
	useState,
} from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import htmlString from '../dist-internal/index.html?raw';
import {
	binaryToBStr,
	bStrToBinary,
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
} from './bridge';

export { bStrToBinary, binaryToBStr };

type StrictOmit<T, K extends keyof T> = Omit<T, K>;
type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
type WebViewOptions = React.ComponentProps<typeof WebView>;

const defaultCoalescingThreshold = 8 * 1024;

/**
 * Message from this pkg to calling RN
 */
export type XtermInbound =
	| { type: 'initialized' }
	| { type: 'data'; data: Uint8Array }
	| { type: 'debug'; message: string };

export type XtermWebViewHandle = {
	write: (data: Uint8Array) => void; // bytes in (batched)
	// Efficiently write many chunks in one postMessage (for initial replay)
	writeMany: (chunks: Uint8Array[]) => void;
	flush: () => void; // force-flush outgoing writes
	clear: () => void;
	focus: () => void;
	resize: (size: { cols: number; rows: number }) => void;
	fit: () => void;
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
	fontFamily: 'Menlo, ui-monospace, monospace',
	fontSize: 10,
};

type UserControllableWebViewProps = StrictOmit<
	WebViewOptions,
	'source' | 'style' | 'injectedJavaScriptBeforeContentLoaded'
>;

export type XtermJsWebViewProps = {
	ref: React.RefObject<XtermWebViewHandle | null>;
	style?: WebViewOptions['style'];
	webViewOptions?: UserControllableWebViewProps;
	xtermOptions?: Partial<ITerminalOptions>;
	onInitialized?: () => void;
	onData?: (data: string) => void;
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

export function XtermJsWebView({
	ref,
	style,
	webViewOptions = defaultWebViewProps,
	xtermOptions = defaultXtermOptions,
	onInitialized,
	onData,
	coalescingThreshold = defaultCoalescingThreshold,
	logger,
	size,
	autoFit = true,
}: XtermJsWebViewProps) {
	const webRef = useRef<WebView>(null);
	const [initialized, setInitialized] = useState(false);

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
		return () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			bufRef.current = null;
		};
	}, []);

	const fit = useCallback(() => {
		sendToWebView({ type: 'fit' });
	}, [sendToWebView]);

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
		resize: (size: { cols: number; rows: number }) => {
			sendToWebView({ type: 'resize', cols: size.cols, rows: size.rows });
			autoFitFn();
			appliedSizeRef.current = size;
		},
		fit,
	}));

	const mergedXTermOptions = useMemo(
		() => ({
			...defaultXtermOptions,
			...xtermOptions,
		}),
		[xtermOptions],
	);

	const appliedXtermOptionsRef = useRef<Partial<ITerminalOptions> | null>(null);

	useEffect(() => {
		if (!initialized) return;
		const appliedXtermOptions = appliedXtermOptionsRef.current;
		if (xTermOptionsEquals(appliedXtermOptions, mergedXTermOptions)) return;
		logger?.log?.(`setting options: `, mergedXTermOptions);
		sendToWebView({ type: 'setOptions', opts: mergedXTermOptions });
		autoFitFn();

		appliedXtermOptionsRef.current = mergedXTermOptions;
	}, [mergedXTermOptions, sendToWebView, logger, initialized, autoFitFn]);

	const onMessage = useCallback(
		(e: WebViewMessageEvent) => {
			try {
				const msg: BridgeInboundMessage = JSON.parse(e.nativeEvent.data);
				logger?.log?.(`received msg from webview: `, msg);
				if (msg.type === 'initialized') {
					onInitialized?.();
					autoFitFn();
					setInitialized(true);
					return;
				}
				if (msg.type === 'input') {
					// const bytes = bStrToBinary(msg.bStr);
					// onData?.(bytes);
					onData?.(msg.str);
					return;
				}
				if (msg.type === 'debug') {
					logger?.log?.(`received debug msg from webview: `, msg.message);
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
		[logger, webViewOptions, onInitialized, autoFitFn, onData],
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

	return (
		<WebView
			ref={webRef}
			source={{ html: htmlString }}
			onMessage={onMessage}
			style={style}
			injectedJavaScriptObject={mergedXTermOptions}
			injectedJavaScriptBeforeContentLoaded={
				mergedXTermOptions.theme?.background
					? `
					document.body.style.backgroundColor = '${mergedXTermOptions.theme.background}';
					true;
					`
					: undefined
			}
			{...mergedWebViewOptions}
		/>
	);
}
