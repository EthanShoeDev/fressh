// Public API for @fressh/react-native-terminal.
// Replaces @fressh/react-native-uniffi-russh + @fressh/react-native-xtermjs-webview.

export { Terminal, type TerminalRef } from './Terminal';
export type { TerminalMethods, TerminalProps } from '../nitro/Terminal.nitro';

export type {
	ConnectionId,
	ConnectOptions,
	ShellId,
	ShellOptions,
} from './ssh';
// TODO(scaffold): export useSshConnect, sshStore, key helpers once the shim lands.
