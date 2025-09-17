/// <reference types="vite/client" />

interface Window {
	terminal?: Terminal;
	terminalWriteBase64?: (data: string) => void;
	ReactNativeWebView?: {
		postMessage?: (data: string) => void;
	};
}
