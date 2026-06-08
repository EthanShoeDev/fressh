// Public API for @fressh/react-native-terminal.
// Replaces @fressh/react-native-uniffi-russh + @fressh/react-native-xtermjs-webview.

export {
	Terminal,
	type CursorBlink,
	type CursorStyle,
	type TerminalComponentProps,
	type TerminalRef,
	type TerminalRenderConfig,
} from './Terminal';
export type { TerminalMethods, TerminalProps } from '../nitro/Terminal.nitro';

// Control plane (§10): connect/shell lifecycle + key helpers + the event stream.
export {
	addFresshEventListener,
	closePreviewTerm,
	closeShell,
	connect,
	createPreviewTerm,
	disconnect,
	FresshEvent_Tags,
	generateKeyPair,
	KeyType,
	resize,
	respondToHostKey,
	scroll,
	Security,
	selectionClear,
	SelectionKind,
	selectionStart,
	selectionText,
	selectionUpdate,
	sendData,
	SshConnectionProgressEvent,
	SshError_Tags,
	startShell,
	TerminalType,
	validatePrivateKey,
} from './ssh';
export type {
	ConnectionDetails,
	ConnectionId,
	FresshEvent,
	FresshEventCallback,
	FresshEventListener,
	ServerPublicKeyInfo,
	ShellId,
	ShellOptions,
} from './ssh';
