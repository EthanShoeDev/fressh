/**
 * We cannot make the generated code match this API exactly because uniffi
 * - Doesn't support ts literals for rust enums
 * - Doesn't support passing a js object with methods and properties to or from rust.
 *
 * The second issue is much harder to get around than the first.
 * In practice it means that if you want to pass an object with callbacks and props to rust, it need to be in seperate args.
 * If you want to pass an object with callbacks and props from rust to js (like ssh handles), you need to instead only pass an object with callbacks
 * just make one of the callbacks a sync info() callback.
 *
 * Then in this api wrapper we can smooth over those rough edges.
 * See: - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
 */
import * as GeneratedRussh from './index';
export type TerminalType = 'Vanilla' | 'Vt100' | 'Vt102' | 'Vt220' | 'Ansi' | 'Xterm' | 'Xterm256';
export type ConnectionDetails = {
    host: string;
    port: number;
    username: string;
    security: {
        type: 'password';
        password: string;
    } | {
        type: 'key';
        privateKey: string;
    };
};
/**
 * This status is only to provide updates for discrete events
 * during the connect() promise.
 *
 * It is no longer relevant after the connect() promise is resolved.
 */
export type SshConnectionProgress = 'tcpConnected' | 'sshHandshake';
export type ConnectOptions = ConnectionDetails & {
    onConnectionProgress?: (status: SshConnectionProgress) => void;
    onDisconnected?: (connectionId: string) => void;
    onServerKey: (serverKeyInfo: GeneratedRussh.ServerPublicKeyInfo, signal?: AbortSignal) => Promise<boolean>;
    abortSignal?: AbortSignal;
};
export type StartShellOptions = {
    term: TerminalType;
    terminalMode?: GeneratedRussh.TerminalMode[];
    terminalPixelSize?: GeneratedRussh.TerminalPixelSize;
    terminalSize?: GeneratedRussh.TerminalSize;
    useTmux: boolean;
    tmuxSessionName: string;
    onClosed?: (shellId: number) => void;
    abortSignal?: AbortSignal;
};
export type CommandOutput = {
    stdout: ArrayBuffer;
    stderr: ArrayBuffer;
    exitStatus: number | null;
    exitSignal: string | null;
};
export type CommandStreamEvent = {
    type: 'stdout';
    bytes: ArrayBuffer;
} | {
    type: 'stderr';
    bytes: ArrayBuffer;
} | {
    type: 'exitStatus';
    exitStatus: number;
} | {
    type: 'exitSignal';
    signalName: string;
} | {
    type: 'closed';
};
export type StartCommandStreamOptions = {
    command: string;
    onEvent: (event: CommandStreamEvent) => void;
    abortSignal?: AbortSignal;
};
export type StreamKind = 'stdout' | 'stderr';
export type TerminalChunk = {
    seq: bigint;
    /** Milliseconds since UNIX epoch (double). */
    tMs: number;
    stream: StreamKind;
    bytes: ArrayBuffer;
};
export type DropNotice = {
    kind: 'dropped';
    fromSeq: bigint;
    toSeq: bigint;
};
export type ListenerEvent = TerminalChunk | DropNotice;
export type Cursor = {
    mode: 'head';
} | {
    mode: 'tailBytes';
    bytes: bigint;
} | {
    mode: 'seq';
    seq: bigint;
} | {
    mode: 'time';
    tMs: number;
} | {
    mode: 'live';
};
export type ListenerOptions = {
    cursor: Cursor;
    /** Optional per-listener coalescing window in ms (e.g., 10–25). */
    coalesceMs?: number;
};
export type BufferReadResult = {
    chunks: TerminalChunk[];
    nextSeq: bigint;
    dropped?: {
        fromSeq: bigint;
        toSeq: bigint;
    };
};
type ProgressTimings = {
    tcpEstablishedAtMs: number;
    sshHandshakeAtMs: number;
};
export type SshConnection = {
    readonly connectionId: string;
    readonly createdAtMs: number;
    readonly connectedAtMs: number;
    readonly connectionDetails: ConnectionDetails;
    readonly progressTimings: ProgressTimings;
    startShell: (opts: StartShellOptions) => Promise<SshShell>;
    runCommand: (opts: {
        command: string;
        maxOutputBytes?: number;
    }, asyncOpts?: {
        signal?: AbortSignal;
    }) => Promise<CommandOutput>;
    startCommandStream: (opts: StartCommandStreamOptions) => Promise<SshCommandStream>;
    disconnect: (opts?: {
        signal?: AbortSignal;
    }) => Promise<void>;
};
export type SshShell = {
    readonly channelId: number;
    readonly createdAtMs: number;
    readonly pty: TerminalType;
    readonly connectionId: string;
    sendData: (data: ArrayBuffer, opts?: {
        signal?: AbortSignal;
    }) => Promise<void>;
    close: (opts?: {
        signal?: AbortSignal;
    }) => Promise<void>;
    /**
     * Resize the PTY window. Call when terminal UI size changes.
     * Sends SSH "window-change" request to deliver SIGWINCH to remote process.
     */
    resizePty: (cols: number, rows: number, opts?: {
        pixelWidth?: number;
        pixelHeight?: number;
        signal?: AbortSignal;
    }) => Promise<void>;
    bufferStats: () => GeneratedRussh.BufferStats;
    currentSeq: () => number;
    readBuffer: (cursor: Cursor, maxBytes?: bigint) => BufferReadResult;
    addListener: (cb: (ev: ListenerEvent) => void, opts: ListenerOptions) => bigint;
    removeListener: (id: bigint) => void;
};
export type SshCommandStream = {
    readonly channelId: number;
    readonly createdAtMs: number;
    readonly connectionId: string;
    sendData: (data: ArrayBuffer, opts?: {
        signal?: AbortSignal;
    }) => Promise<void>;
    close: (opts?: {
        signal?: AbortSignal;
    }) => Promise<void>;
};
export declare const DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES: number;
export declare const MAX_RUN_COMMAND_MAX_OUTPUT_BYTES: number;
declare function connect({ onServerKey, onConnectionProgress, onDisconnected, ...options }: ConnectOptions): Promise<SshConnection>;
declare function generateKeyPair(type: 'rsa' | 'ecdsa' | 'ed25519'): Promise<string>;
declare function validatePrivateKey(key: string): {
    valid: true;
    error?: never;
} | {
    valid: false;
    error: GeneratedRussh.SshError;
};
declare function extractPublicKey(privateKey: string): {
    publicKey: string;
    error?: never;
} | {
    publicKey?: never;
    error: GeneratedRussh.SshError;
};
export { SshError, SshError_Tags } from './generated/uniffi_russh';
export declare const RnRussh: {
    uniffiInitAsync: typeof GeneratedRussh.uniffiInitAsync;
    connect: typeof connect;
    generateKeyPair: typeof generateKeyPair;
    validatePrivateKey: typeof validatePrivateKey;
    extractPublicKey: typeof extractPublicKey;
};
//# sourceMappingURL=api.d.ts.map