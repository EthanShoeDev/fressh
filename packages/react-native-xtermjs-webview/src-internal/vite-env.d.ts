/// <reference types="vite/client" />

interface Window {
	terminal?: Terminal;
	fitAddon?: FitAddon;
	terminalWriteBase64?: (data: string) => void;
	ReactNativeWebView?: {
		postMessage?: (data: string) => void;
	};
}
