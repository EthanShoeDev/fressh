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
	| {
			type: 'setOptions';
			opts: Partial<{
				cursorBlink: boolean;
				scrollback: number;
				fontFamily: string;
				fontSize: number;
			}>;
	  }
	| { type: 'clear' }
	| { type: 'focus' };

export type XtermInbound =
	| { type: 'initialized' }
	| { type: 'data'; data: Uint8Array }
	| { type: 'debug'; message: string };

export type XtermWebViewHandle = {
	write: (data: Uint8Array) => void; // bytes in (batched)
	flush: () => void; // force-flush outgoing writes
	resize: (cols?: number, rows?: number) => void;
	setFont: (family?: string, size?: number) => void;
	setTheme: (background?: string, foreground?: string) => void;
	setOptions: (
		opts: OutboundMessage extends { type: 'setOptions'; opts: infer O }
			? O
			: never,
	) => void;
	clear: () => void;
	focus: () => void;
};

export interface XtermJsWebViewProps
	extends StrictOmit<
		React.ComponentProps<typeof WebView>,
		'source' | 'originWhitelist' | 'onMessage'
	> {
	ref: React.RefObject<XtermWebViewHandle | null>;
	onMessage?: (msg: XtermInbound) => void;

	// xterm-ish props
	fontFamily?: string;
	fontSize?: number;
	cursorBlink?: boolean;
	scrollback?: number;
	themeBackground?: string;
	themeForeground?: string;
}

export function XtermJsWebView({
	ref,
	onMessage,
	fontFamily,
	fontSize,
	cursorBlink,
	scrollback,
	themeBackground,
	themeForeground,
	...props
}: XtermJsWebViewProps) {
	const webRef = useRef<WebView>(null);

	// ---- RN -> WebView message sender
	const send = (obj: OutboundMessage) => {
		const payload = JSON.stringify(obj);
		console.log('sending msg', payload);
		const js = `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(
			payload,
		)}})); true;`;
		webRef.current?.injectJavaScript(js);
	};

	// ---- rAF + 8KB coalescer for writes
	const bufRef = useRef<Uint8Array | null>(null);
	const rafRef = useRef<number | null>(null);
	const THRESHOLD = 8 * 1024;

	const flush = () => {
		if (!bufRef.current) return;
		const b64 = Base64.fromUint8Array(bufRef.current);
		bufRef.current = null;
		if (rafRef.current != null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		send({ type: 'write', b64 });
	};

	const schedule = () => {
		if (rafRef.current != null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			flush();
		});
	};

	const write = (data: Uint8Array) => {
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
		if ((bufRef.current?.length ?? 0) >= THRESHOLD) flush();
		else schedule();
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
		setOptions: (opts) => send({ type: 'setOptions', opts }),
		clear: () => send({ type: 'clear' }),
		focus: () => send({ type: 'focus' }),
	}));

	// Cleanup pending rAF on unmount
	useEffect(() => {
		return () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			bufRef.current = null;
		};
	}, []);

	// Push initial options/theme whenever props change
	useEffect(() => {
		const opts: Record<string, unknown> = {};
		if (typeof cursorBlink === 'boolean') opts.cursorBlink = cursorBlink;
		if (typeof scrollback === 'number') opts.scrollback = scrollback;
		if (fontFamily) opts.fontFamily = fontFamily;
		if (typeof fontSize === 'number') opts.fontSize = fontSize;
		if (Object.keys(opts).length) send({ type: 'setOptions', opts });
	}, [cursorBlink, scrollback, fontFamily, fontSize]);

	useEffect(() => {
		if (themeBackground || themeForeground) {
			send({
				type: 'setTheme',
				background: themeBackground,
				foreground: themeForeground,
			});
		}
	}, [themeBackground, themeForeground]);

	return (
		<WebView
			ref={webRef}
			originWhitelist={['*']}
			source={{ html: htmlString }}
			onMessage={(e) => {
				try {
					const msg: InboundMessage = JSON.parse(e.nativeEvent.data);
					console.log('received msg', msg);
					if (msg.type === 'initialized') {
						onMessage?.({ type: 'initialized' });
						return;
					}
					if (msg.type === 'input') {
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
