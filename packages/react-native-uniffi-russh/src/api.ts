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

// #region Ideal API

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

export type TerminalType =
  | 'Vanilla'
  | 'Vt100'
  | 'Vt102'
  | 'Vt220'
  | 'Ansi'
  | 'Xterm'
  | 'Xterm256';

export type ConnectionDetails = {
  host: string;
  port: number;
  username: string;
  security:
    | { type: 'password'; password: string }
    | { type: 'key'; privateKey: string };
};

/**
 * This status is only to provide updates for discrete events
 * during the connect() promise.
 *
 * It is no longer relevant after the connect() promise is resolved.
 */
export type SshConnectionProgress =
  | 'tcpConnected' // TCP established, starting SSH handshake
  | 'sshHandshake'; // SSH protocol negotiation complete

export type ConnectOptions = ConnectionDetails & {
  onConnectionProgress?: (status: SshConnectionProgress) => void;
  onDisconnected?: (connectionId: string) => void;
  abortSignal?: AbortSignal;
};

export type StartShellOptions = {
  term: TerminalType;
  terminalMode?: GeneratedRussh.TerminalMode[];
  terminalPixelSize?: GeneratedRussh.TerminalPixelSize;
  terminalSize?: GeneratedRussh.TerminalSize;
  onClosed?: (shellId: number) => void;
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

export type DropNotice = { kind: 'dropped'; fromSeq: bigint; toSeq: bigint };
export type ListenerEvent = TerminalChunk | DropNotice;

export type Cursor =
  | { mode: 'head' } // earliest available in ring
  | { mode: 'tailBytes'; bytes: bigint } // last N bytes (best-effort)
  | { mode: 'seq'; seq: bigint } // from a given sequence
  | { mode: 'time'; tMs: number } // from timestamp
  | { mode: 'live' }; // no replay, live only

export type ListenerOptions = {
  cursor: Cursor;
  /** Optional per-listener coalescing window in ms (e.g., 10–25). */
  coalesceMs?: number;
};

export type BufferReadResult = {
  chunks: TerminalChunk[];
  nextSeq: bigint;
  dropped?: { fromSeq: bigint; toSeq: bigint };
};

// ─────────────────────────────────────────────────────────────────────────────
// Handles
// ─────────────────────────────────────────────────────────────────────────────

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
  disconnect: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type SshShell = {
  readonly channelId: number;
  readonly createdAtMs: number;
  readonly pty: TerminalType;
  readonly connectionId: string;

  // I/O
  sendData: (
    data: ArrayBuffer,
    opts?: { signal?: AbortSignal }
  ) => Promise<void>;
  close: (opts?: { signal?: AbortSignal }) => Promise<void>;

  // Buffer policy & stats
  // setBufferPolicy: (policy: {
  //   ringBytes?: number;
  //   coalesceMs?: number;
  // }) => Promise<void>;
  bufferStats: () => GeneratedRussh.BufferStats;
  currentSeq: () => number;

  // Replay + live
  readBuffer: (cursor: Cursor, maxBytes?: bigint) => BufferReadResult;
  addListener: (
    cb: (ev: ListenerEvent) => void,
    opts: ListenerOptions
  ) => bigint;
  removeListener: (id: bigint) => void;
};

type RusshApi = {
  uniffiInitAsync: () => Promise<void>;
  connect: (opts: ConnectOptions) => Promise<SshConnection>;
  generateKeyPair: (
    type: 'rsa' | 'ecdsa' | 'ed25519'
    // TODO: Add these
    // passphrase?: string;
    // keySize?: number;
    // comment?: string;
  ) => Promise<string>;
  validatePrivateKey: (
    key: string
  ) =>
    | { valid: true; error?: never }
    | { valid: false; error: GeneratedRussh.SshError };
};

// #endregion

// #region Wrapper to match the ideal API

const terminalTypeLiteralToEnum = {
  Vanilla: GeneratedRussh.TerminalType.Vanilla,
  Vt100: GeneratedRussh.TerminalType.Vt100,
  Vt102: GeneratedRussh.TerminalType.Vt102,
  Vt220: GeneratedRussh.TerminalType.Vt220,
  Ansi: GeneratedRussh.TerminalType.Ansi,
  Xterm: GeneratedRussh.TerminalType.Xterm,
  Xterm256: GeneratedRussh.TerminalType.Xterm256,
} as const satisfies Record<string, GeneratedRussh.TerminalType>;

const terminalTypeEnumToLiteral: Record<
  GeneratedRussh.TerminalType,
  TerminalType
> = {
  [GeneratedRussh.TerminalType.Vanilla]: 'Vanilla',
  [GeneratedRussh.TerminalType.Vt100]: 'Vt100',
  [GeneratedRussh.TerminalType.Vt102]: 'Vt102',
  [GeneratedRussh.TerminalType.Vt220]: 'Vt220',
  [GeneratedRussh.TerminalType.Ansi]: 'Ansi',
  [GeneratedRussh.TerminalType.Xterm]: 'Xterm',
  [GeneratedRussh.TerminalType.Xterm256]: 'Xterm256',
};

const sshConnProgressEnumToLiteral = {
  [GeneratedRussh.SshConnectionProgressEvent.TcpConnected]: 'tcpConnected',
  [GeneratedRussh.SshConnectionProgressEvent.SshHandshake]: 'sshHandshake',
} as const satisfies Record<
  GeneratedRussh.SshConnectionProgressEvent,
  SshConnectionProgress
>;

const streamEnumToLiteral = {
  [GeneratedRussh.StreamKind.Stdout]: 'stdout',
  [GeneratedRussh.StreamKind.Stderr]: 'stderr',
} as const satisfies Record<GeneratedRussh.StreamKind, StreamKind>;

function generatedConnDetailsToIdeal(
  details: GeneratedRussh.ConnectionDetails
): ConnectionDetails {
  const security: ConnectionDetails['security'] =
    details.security instanceof GeneratedRussh.Security.Password
      ? { type: 'password', password: details.security.inner.password }
      : { type: 'key', privateKey: details.security.inner.privateKeyContent };
  return {
    host: details.host,
    port: details.port,
    username: details.username,
    security,
  };
}

function cursorToGenerated(cursor: Cursor): GeneratedRussh.Cursor {
  switch (cursor.mode) {
    case 'head':
      return new GeneratedRussh.Cursor.Head();
    case 'tailBytes':
      return new GeneratedRussh.Cursor.TailBytes({
        bytes: cursor.bytes,
      });
    case 'seq':
      return new GeneratedRussh.Cursor.Seq({ seq: cursor.seq });
    case 'time':
      return new GeneratedRussh.Cursor.TimeMs({ tMs: cursor.tMs });
    case 'live':
      return new GeneratedRussh.Cursor.Live();
  }
}

function toTerminalChunk(ch: GeneratedRussh.TerminalChunk): TerminalChunk {
  return {
    seq: ch.seq,
    tMs: ch.tMs,
    stream: streamEnumToLiteral[ch.stream],
    bytes: ch.bytes,
  };
}

function wrapShellSession(
  shell: GeneratedRussh.ShellSessionInterface
): SshShell {
  const info = shell.getInfo();

  const readBuffer: SshShell['readBuffer'] = (cursor, maxBytes) => {
    const res = shell.readBuffer(cursorToGenerated(cursor), maxBytes);
    return {
      chunks: res.chunks.map(toTerminalChunk),
      nextSeq: res.nextSeq,
      dropped: res.dropped,
    } satisfies BufferReadResult;
  };

  const addListener: SshShell['addListener'] = (cb, opts) => {
    const listener = {
      onEvent: (ev: GeneratedRussh.ShellEvent) => {
        if (ev instanceof GeneratedRussh.ShellEvent.Chunk) {
          cb(toTerminalChunk(ev.inner[0]!));
        } else if (ev instanceof GeneratedRussh.ShellEvent.Dropped) {
          cb({
            kind: 'dropped',
            fromSeq: ev.inner.fromSeq,
            toSeq: ev.inner.toSeq,
          });
        }
      },
    } satisfies GeneratedRussh.ShellListener;

    try {
      const id = shell.addListener(listener, {
        cursor: cursorToGenerated(opts.cursor),
        coalesceMs: opts.coalesceMs,
      });
      if (id === 0n) {
        throw new Error('Failed to attach shell listener (id=0)');
      }
      return id;
    } catch (e) {
      throw new Error(
        `addListener failed: ${String((e as any)?.message ?? e)}`
      );
    }
  };

  return {
    channelId: info.channelId,
    createdAtMs: info.createdAtMs,
    pty: terminalTypeEnumToLiteral[info.term],
    connectionId: info.connectionId,
    sendData: (data, o) =>
      shell.sendData(data, o?.signal ? { signal: o.signal } : undefined),
    close: (o) => shell.close(o?.signal ? { signal: o.signal } : undefined),
    // setBufferPolicy,
    bufferStats: shell.bufferStats,
    currentSeq: () => Number(shell.currentSeq()),
    readBuffer,
    addListener,
    removeListener: (id) => shell.removeListener(id),
  };
}

function wrapConnection(
  conn: GeneratedRussh.SshConnectionInterface
): SshConnection {
  const info = conn.getInfo();
  return {
    connectionId: info.connectionId,
    connectionDetails: generatedConnDetailsToIdeal(info.connectionDetails),
    createdAtMs: info.createdAtMs,
    connectedAtMs: info.connectedAtMs,
    progressTimings: {
      tcpEstablishedAtMs: info.progressTimings.tcpEstablishedAtMs,
      sshHandshakeAtMs: info.progressTimings.sshHandshakeAtMs,
    },
    startShell: async ({ onClosed, ...params }) => {
      const shell = await conn.startShell(
        {
          term: terminalTypeLiteralToEnum[params.term],
          onClosedCallback: onClosed
            ? {
                onChange: (channelId) => onClosed(channelId),
              }
            : undefined,
          terminalMode: params.terminalMode,
          terminalPixelSize: params.terminalPixelSize,
          terminalSize: params.terminalSize,
        },
        params.abortSignal ? { signal: params.abortSignal } : undefined
      );
      return wrapShellSession(shell);
    },
    disconnect: (opts) =>
      conn.disconnect(opts?.signal ? { signal: opts.signal } : undefined),
  };
}

async function connect(options: ConnectOptions): Promise<SshConnection> {
  const security =
    options.security.type === 'password'
      ? new GeneratedRussh.Security.Password({
          password: options.security.password,
        })
      : new GeneratedRussh.Security.Key({
          privateKeyContent: options.security.privateKey,
        });
  const sshConnection = await GeneratedRussh.connect(
    {
      connectionDetails: {
        host: options.host,
        port: options.port,
        username: options.username,
        security,
      },
      onConnectionProgressCallback: options.onConnectionProgress
        ? {
            onChange: (statusEnum) =>
              options.onConnectionProgress!(
                sshConnProgressEnumToLiteral[statusEnum]
              ),
          }
        : undefined,
      onDisconnectedCallback: options.onDisconnected
        ? {
            onChange: (connectionId) => options.onDisconnected!(connectionId),
          }
        : undefined,
    },
    options.abortSignal ? { signal: options.abortSignal } : undefined
  );
  return wrapConnection(sshConnection);
}

async function generateKeyPair(type: 'rsa' | 'ecdsa' | 'ed25519') {
  const map = {
    rsa: GeneratedRussh.KeyType.Rsa,
    ecdsa: GeneratedRussh.KeyType.Ecdsa,
    ed25519: GeneratedRussh.KeyType.Ed25519,
  } as const;
  return GeneratedRussh.generateKeyPair(map[type]);
}

function validatePrivateKey(
  key: string
):
  | { valid: true; error?: never }
  | { valid: false; error: GeneratedRussh.SshError } {
  try {
    GeneratedRussh.validatePrivateKey(key);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e as GeneratedRussh.SshError };
  }
}

// #endregion

export { SshError, SshError_Tags } from './generated/uniffi_russh';

export const RnRussh = {
  uniffiInitAsync: GeneratedRussh.uniffiInitAsync,
  connect,
  generateKeyPair,
  validatePrivateKey,
} satisfies RusshApi;
