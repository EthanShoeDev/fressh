type ITerminalOptions = import('@xterm/xterm').ITerminalOptions;
import { Base64 } from 'js-base64';
import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import htmlString from '../dist-internal/index.html?raw';
import {
	type BridgeInboundMessage,
	type BridgeOutboundMessage,
	type TerminalOptionsPatch,
} from './bridge';
// Re-exported shared types live in src/bridge.ts for library build
// Internal page imports the same file via ../src/bridge

type StrictOmit<T, K extends keyof T> = Omit<T, K>;

/**
 * Message from the webview to RN
 */
type InboundMessage = BridgeInboundMessage;

/**
 * Message from RN to the webview
 */
type OutboundMessage = BridgeOutboundMessage;

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
	resize: (cols?: number, rows?: number) => void;
	setFont: (family?: string, size?: number) => void;
	setTheme: (background?: string, foreground?: string) => void;
	setOptions: (opts: TerminalOptionsPatch) => void;
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

	// xterm Terminal.setOptions props (typed from @xterm/xterm)
	options?: Partial<ITerminalOptions>;
}

export function XtermJsWebView({
	ref,
	onMessage,
	options,
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

	const writeMany = (chunks: Uint8Array[]) => {
		if (!chunks || chunks.length === 0) return;
		// Ensure any pending small buffered write is flushed before bulk write
		flush();
		const b64s = chunks.map((c) => Base64.fromUint8Array(c));
		send({ type: 'write', chunks: b64s });
	};

	useImperativeHandle(ref, () => ({
		write,
		writeMany,
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

	// Apply options changes via setOptions without remounting
	const prevOptsRef = useRef<Partial<ITerminalOptions> | null>(null);
	useEffect(() => {
		const merged: Partial<ITerminalOptions> = {
			...(options ?? {}),
		};

		// Compute shallow patch of changed keys to reduce noise
		const prev: Partial<ITerminalOptions> = (prevOptsRef.current ??
			{}) as Partial<ITerminalOptions>;
		type PatchRecord = Partial<
			Record<keyof ITerminalOptions, ITerminalOptions[keyof ITerminalOptions]>
		>;
		const patch: PatchRecord = {};
		const keys = new Set<string>([
			...Object.keys(prev as object),
			...Object.keys(merged as object),
		]);
		let changed = false;
		for (const k of keys) {
			const key = k as keyof ITerminalOptions;
			const prevVal = prev[key];
			const nextVal = merged[key];
			if (prevVal !== nextVal) {
				patch[key] = nextVal as ITerminalOptions[keyof ITerminalOptions];
				changed = true;
			}
		}
		if (changed) {
			send({ type: 'setOptions', opts: patch });
			prevOptsRef.current = merged;
		}
	}, [options]);

	return (
		<WebView
			ref={webRef}
			originWhitelist={['*']}
			scalesPageToFit={false}
			contentMode="mobile"
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
