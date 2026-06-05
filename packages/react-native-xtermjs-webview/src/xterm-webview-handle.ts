import  { type BridgeOutboundMessage } from './bridge';

type TerminalSize = { cols: number; rows: number };
type FocusableWebViewRef = {
	current: { requestFocus?: () => void } | null;
};
type MutableRef<T> = { current: T };

export type XtermWebViewHandle = {
	write: (data: Uint8Array) => void;
	writeMany: (chunks: Uint8Array[]) => void;
	flush: () => void;
	clear: () => void;
	focus: () => void;
	setSystemKeyboardEnabled: (enabled: boolean) => void;
	setSelectionModeEnabled: (enabled: boolean) => void;
	getSelection: () => Promise<string>;
	resize: (size: TerminalSize) => void;
	fit: () => void;
	exitScrollback: (opts?: {
		requestId?: number;
		instanceId?: string;
		emitExit?: boolean;
	}) => void;
	sendScrollbackEnterAck: (requestId: number, instanceId: string) => void;
	sendTmuxEnterCopyModeAck: (requestId: number, instanceId: string) => void;
};

export type XtermWebViewHandleDeps = {
	write: XtermWebViewHandle['write'];
	writeMany: XtermWebViewHandle['writeMany'];
	flush: XtermWebViewHandle['flush'];
	sendToWebView: (message: BridgeOutboundMessage) => void;
	webRef: FocusableWebViewRef;
	setSystemKeyboardEnabled: XtermWebViewHandle['setSystemKeyboardEnabled'];
	setSelectionModeEnabled: XtermWebViewHandle['setSelectionModeEnabled'];
	getSelection: XtermWebViewHandle['getSelection'];
	autoFitFn: () => void;
	appliedSizeRef: MutableRef<TerminalSize | null>;
	fit: XtermWebViewHandle['fit'];
	sendScrollbackEnterAck: XtermWebViewHandle['sendScrollbackEnterAck'];
	sendTmuxEnterCopyModeAck: XtermWebViewHandle['sendTmuxEnterCopyModeAck'];
};

export function createXtermWebViewAckSenders(
	sendToWebView: (message: BridgeOutboundMessage) => void,
): Pick<
	XtermWebViewHandle,
	'sendScrollbackEnterAck' | 'sendTmuxEnterCopyModeAck'
> {
	return {
		sendScrollbackEnterAck: (requestId, instanceId) => {
			sendToWebView({
				type: 'scrollbackEnterAck',
				requestId,
				instanceId,
			});
		},
		sendTmuxEnterCopyModeAck: (requestId, instanceId) => {
			sendToWebView({
				type: 'tmuxEnterCopyModeAck',
				requestId,
				instanceId,
			});
		},
	};
}

export function createXtermWebViewHandle({
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
	sendScrollbackEnterAck,
	sendTmuxEnterCopyModeAck,
}: XtermWebViewHandleDeps): XtermWebViewHandle {
	return {
		write,
		writeMany,
		flush,
		clear: () => sendToWebView({ type: 'clear' }),
		focus: () => {
			sendToWebView({ type: 'focus' });
			webRef.current?.requestFocus?.();
		},
		setSystemKeyboardEnabled,
		setSelectionModeEnabled,
		getSelection,
		resize: (size: TerminalSize) => {
			sendToWebView({ type: 'resize', cols: size.cols, rows: size.rows });
			autoFitFn();
			appliedSizeRef.current = size;
		},
		fit,
		exitScrollback: (opts) => {
			sendToWebView({ type: 'exitScrollback', ...opts });
		},
		sendScrollbackEnterAck,
		sendTmuxEnterCopyModeAck,
	};
}
