import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import htmlString from '../dist-internal/index.html?raw';
import { Base64 } from 'js-base64';

type StrictOmit<T, K extends keyof T> = Omit<T, K>;

type InboundMessage =
	| { type: 'initialized' }
	| { type: 'input'; b64: string } // user typed data from xterm -> RN
	| { type: 'debug'; message: string };

type OutboundMessage =
	| { type: 'write'; b64: string }
	| { type: 'write'; chunks: string[] }
	| { type: 'resize'; cols?: number; rows?: number }
	| { type: 'setFont'; family?: string; size?: number }
	| { type: 'setTheme'; background?: string; foreground?: string }
	| { type: 'clear' }
	| { type: 'focus' };

export type XtermWebViewHandle = {
	/**
	 * Push raw bytes (Uint8Array) into the terminal.
	 * Writes are batched (rAF or >=8KB) for performance.
	 */
	write: (data: Uint8Array) => void;

	/** Force-flush any buffered output immediately. */
	flush: () => void;

	/** Resize the terminal to given cols/rows (optional, fit addon also runs). */
	resize: (cols?: number, rows?: number) => void;

	/** Set font props inside the WebView page. */
	setFont: (family?: string, size?: number) => void;

	/** Set basic theme colors (background/foreground). */
	setTheme: (background?: string, foreground?: string) => void;

	/** Clear terminal contents. */
	clear: () => void;

	/** Focus the terminal input. */
	focus: () => void;
};

export function XtermJsWebView({
	ref,
	onMessage,
	...props
}: StrictOmit<
	React.ComponentProps<typeof WebView>,
	'source' | 'originWhitelist' | 'onMessage'
> & {
	ref: React.RefObject<XtermWebViewHandle | null>;
	onMessage?: (
		msg:
			| { type: 'initialized' }
			| { type: 'data'; data: Uint8Array } // input from xterm (user typed)
			| { type: 'debug'; message: string },
	) => void;
}) {
	const webViewRef = useRef<WebView>(null);

	// ---- RN -> WebView message sender via injectJavaScript + window MessageEvent
	const send = (obj: OutboundMessage) => {
		const payload = JSON.stringify(obj);
		const js = `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(
			payload,
		)}})); true;`;
		webViewRef.current?.injectJavaScript(js);
	};

	// ---- rAF + 8KB coalescer for writes
	const writeBufferRef = useRef<Uint8Array | null>(null);
	const rafIdRef = useRef<number | null>(null);
	const THRESHOLD = 8 * 1024; // 8KB

	const flush = () => {
		if (!writeBufferRef.current) return;
		const b64 = Base64.fromUint8Array(writeBufferRef.current);
		writeBufferRef.current = null;
		if (rafIdRef.current != null) {
			cancelAnimationFrame(rafIdRef.current);
			rafIdRef.current = null;
		}
		send({ type: 'write', b64 });
	};

	const scheduleFlush = () => {
		if (rafIdRef.current != null) return;
		rafIdRef.current = requestAnimationFrame(() => {
			rafIdRef.current = null;
			flush();
		});
	};

	const write = (data: Uint8Array) => {
		if (!data || data.length === 0) return;
		const chunk = data; // already a fresh Uint8Array per caller
		if (!writeBufferRef.current) {
			writeBufferRef.current = chunk;
		} else {
			// concat
			const a = writeBufferRef.current;
			const merged = new Uint8Array(a.length + chunk.length);
			merged.set(a, 0);
			merged.set(chunk, a.length);
			writeBufferRef.current = merged;
		}
		if ((writeBufferRef.current?.length ?? 0) >= THRESHOLD) {
			flush();
		} else {
			scheduleFlush();
		}
	};

	useImperativeHandle(ref, () => ({
		write,
		flush,
		resize: (cols?: number, rows?: number) =>
			send({ type: 'resize', cols, rows }),
		setFont: (family?: string, size?: number) =>
			send({ type: 'setFont', family, size }),
		setTheme: (background?: string, foreground?: string) =>
			send({ type: 'setTheme', background, foreground }),
		clear: () => send({ type: 'clear' }),
		focus: () => send({ type: 'focus' }),
	}));

	// Cleanup pending rAF on unmount
	useEffect(() => {
		return () => {
			if (rafIdRef.current != null) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = null;
			}
			writeBufferRef.current = null;
		};
	}, []);

	return (
		<WebView
			ref={webViewRef}
			originWhitelist={['*']}
			source={{ html: htmlString }}
			onMessage={(event) => {
				try {
					const msg: InboundMessage = JSON.parse(event.nativeEvent.data);
					if (msg.type === 'initialized') {
						onMessage?.({ type: 'initialized' });
						return;
					}
					if (msg.type === 'input') {
						// Convert base64 -> bytes for the caller (SSH writer)
						const bytes = Base64.toUint8Array(msg.b64);
						onMessage?.({ type: 'data', data: bytes });
						return;
					}
					if (msg.type === 'debug') {
						onMessage?.({ type: 'debug', message: msg.message });
						return;
					}
				} catch {
					// ignore unknown payloads
				}
			}}
			{...props}
		/>
	);
}
