// Public API for @fressh/react-native-terminal.
// Replaces @fressh/react-native-uniffi-russh + @fressh/react-native-xtermjs-webview.

export { Terminal, type TerminalRef } from './Terminal';
export type { TerminalMethods, TerminalProps } from '../nitro/Terminal.nitro';

// Control plane (§10): connect/shell lifecycle + key helpers + the event stream.
export {
	addFresshEventListener,
	closeShell,
	connect,
	disconnect,
	FresshEvent_Tags,
	generateKeyPair,
	KeyType,
	resize,
	respondToHostKey,
	Security,
	sendData,
	SshConnectionProgressEvent,
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
