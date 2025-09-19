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

export type PtyType =
  | 'Vanilla' | 'Vt100' | 'Vt102' | 'Vt220' | 'Ansi' | 'Xterm' | 'Xterm256';

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
  | 'tcpConnected'        // TCP established, starting SSH handshake
  | 'sshHandshake'        // SSH protocol negotiation complete



export type ConnectOptions = ConnectionDetails & {
  onConnectionProgress?: (status: SshConnectionProgress) => void;
  onDisconnected?: (connectionId: string) => void;
  abortSignal?: AbortSignal;
};

export type StartShellOptions = {
  pty: PtyType;
  onClosed?: (shellId: string) => void;
  abortSignal?: AbortSignal;
};

export type StreamKind = 'stdout' | 'stderr';

export type TerminalChunk = {
  /** Monotonic sequence number from the shell start (Rust u64; JS uses number). */
  seq: number;
  /** Milliseconds since UNIX epoch (double). */
  tMs: number;
  stream: StreamKind;
  bytes: Uint8Array;
};

export type DropNotice = { kind: 'dropped'; fromSeq: number; toSeq: number };
export type ListenerEvent = TerminalChunk | DropNotice;

export type Cursor =
  | { mode: 'head' }                      // earliest available in ring
  | { mode: 'tailBytes'; bytes: number }  // last N bytes (best-effort)
  | { mode: 'seq'; seq: number }          // from a given sequence
  | { mode: 'time'; tMs: number }         // from timestamp
  | { mode: 'live' };                     // no replay, live only

export type ListenerOptions = {
  cursor: Cursor;
  /** Optional per-listener coalescing window in ms (e.g., 10–25). */
  coalesceMs?: number;
};

export type BufferStats = {
  ringBytes: number;         // configured capacity
  usedBytes: number;         // current usage
  chunks: number;            // chunks kept
  headSeq: number;           // oldest seq retained
  tailSeq: number;           // newest seq retained
  droppedBytesTotal: number; // cumulative eviction
};

export type BufferReadResult = {
  chunks: TerminalChunk[];
  nextSeq: number;
  dropped?: { fromSeq: number; toSeq: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Handles
// ─────────────────────────────────────────────────────────────────────────────

export type SshConnection = {
  readonly connectionId: string;
  readonly createdAtMs: number;
  readonly tcpEstablishedAtMs: number;
  readonly connectionDetails: ConnectionDetails;

  startShell: (opts: StartShellOptions) => Promise<SshShell>;
  disconnect: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export type SshShell = {
  readonly channelId: number;
  readonly createdAtMs: number;
  readonly pty: PtyType;
  readonly connectionId: string;

  // I/O
  sendData: (data: ArrayBuffer, opts?: { signal?: AbortSignal }) => Promise<void>;
  close: (opts?: { signal?: AbortSignal }) => Promise<void>;

  // Buffer policy & stats
  setBufferPolicy: (policy: { ringBytes?: number; coalesceMs?: number }) => Promise<void>;
  bufferStats: () => Promise<BufferStats>;
  currentSeq: () => Promise<number>;

  // Replay + live
  readBuffer: (cursor: Cursor, maxBytes?: number) => Promise<BufferReadResult>;
  addListener: (
    cb: (ev: ListenerEvent) => void,
    opts: ListenerOptions
  ) => bigint;
  removeListener: (id: bigint) => void;
};

type RusshApi = {
  uniffiInitAsync: () => Promise<void>;
  connect: (opts: ConnectOptions) => Promise<SshConnection>;
  generateKeyPair: (type: 'rsa' | 'ecdsa' | 'ed25519') => Promise<string>;
};

// #endregion

// #region Wrapper to match the ideal API

const ptyTypeLiteralToEnum = {
  Vanilla: GeneratedRussh.PtyType.Vanilla,
  Vt100: GeneratedRussh.PtyType.Vt100,
  Vt102: GeneratedRussh.PtyType.Vt102,
  Vt220: GeneratedRussh.PtyType.Vt220,
  Ansi: GeneratedRussh.PtyType.Ansi,
  Xterm: GeneratedRussh.PtyType.Xterm,
  Xterm256: GeneratedRussh.PtyType.Xterm256,
} as const satisfies Record<string, GeneratedRussh.PtyType>;

const ptyEnumToLiteral: Record<GeneratedRussh.PtyType, PtyType> = {
  [GeneratedRussh.PtyType.Vanilla]: 'Vanilla',
  [GeneratedRussh.PtyType.Vt100]: 'Vt100',
  [GeneratedRussh.PtyType.Vt102]: 'Vt102',
  [GeneratedRussh.PtyType.Vt220]: 'Vt220',
  [GeneratedRussh.PtyType.Ansi]: 'Ansi',
  [GeneratedRussh.PtyType.Xterm]: 'Xterm',
  [GeneratedRussh.PtyType.Xterm256]: 'Xterm256',
};

const sshConnStatusEnumToLiteral = {
  [GeneratedRussh.SshConnectionStatus.TcpConnected]: 'tcpConnected',
  [GeneratedRussh.SshConnectionStatus.SshHandshake]: 'sshHandshake',
} as const satisfies Record<GeneratedRussh.SshConnectionStatus, SshConnectionProgress>;

const streamEnumToLiteral = {
  [GeneratedRussh.StreamKind.Stdout]: 'stdout',
  [GeneratedRussh.StreamKind.Stderr]: 'stderr',
} as const satisfies Record<GeneratedRussh.StreamKind, StreamKind>;

function generatedConnDetailsToIdeal(details: GeneratedRussh.ConnectionDetails): ConnectionDetails {
  const security: ConnectionDetails['security'] = details.security instanceof GeneratedRussh.Security.Password
    ? { type: 'password', password: details.security.inner.password }
    : { type: 'key', privateKey: details.security.inner.keyId };
  return { host: details.host, port: details.port, username: details.username, security };
}

function cursorToGenerated(cursor: Cursor): GeneratedRussh.Cursor {
  switch (cursor.mode) {
    case 'head':
      return new GeneratedRussh.Cursor.Head();
    case 'tailBytes':
      return new GeneratedRussh.Cursor.TailBytes({ bytes: BigInt(cursor.bytes) });
    case 'seq':
      return new GeneratedRussh.Cursor.Seq({ seq: BigInt(cursor.seq) });
    case 'time':
      return new GeneratedRussh.Cursor.TimeMs({ tMs: cursor.tMs });
    case 'live':
      return new GeneratedRussh.Cursor.Live();
  }
}

function toTerminalChunk(ch: GeneratedRussh.TerminalChunk): TerminalChunk {
  return {
    seq: Number(ch.seq),
    tMs: ch.tMs,
    stream: streamEnumToLiteral[ch.stream],
    bytes: new Uint8Array(ch.bytes as any),
  };
}

function wrapShellSession(shell: GeneratedRussh.ShellSessionInterface): SshShell {
  const info = shell.info();

  const setBufferPolicy: SshShell['setBufferPolicy'] = async (policy) => {
    await shell.setBufferPolicy(policy.ringBytes != null ? BigInt(policy.ringBytes) : undefined, policy.coalesceMs);
  };

  const bufferStats: SshShell['bufferStats'] = async () => {
    const s = shell.bufferStats();
    return {
      ringBytes: Number(s.ringBytes),
      usedBytes: Number(s.usedBytes),
      chunks: Number(s.chunks),
      headSeq: Number(s.headSeq),
      tailSeq: Number(s.tailSeq),
      droppedBytesTotal: Number(s.droppedBytesTotal),
    };
  };

  const readBuffer: SshShell['readBuffer'] = async (cursor, maxBytes) => {
    const res = shell.readBuffer(cursorToGenerated(cursor), maxBytes != null ? BigInt(maxBytes) : undefined);
    return {
      chunks: res.chunks.map(toTerminalChunk),
      nextSeq: Number(res.nextSeq),
      dropped: res.dropped ? { fromSeq: Number(res.dropped.fromSeq), toSeq: Number(res.dropped.toSeq) } : undefined,
    } satisfies BufferReadResult;
  };

  const addListener: SshShell['addListener'] = (cb, opts) => {
    const listener = {
      onEvent: (ev: GeneratedRussh.ShellEvent) => {
        if (ev instanceof GeneratedRussh.ShellEvent.Chunk) {
          cb(toTerminalChunk(ev.inner[0]!));
        } else if (ev instanceof GeneratedRussh.ShellEvent.Dropped) {
          cb({ kind: 'dropped', fromSeq: Number(ev.inner.fromSeq), toSeq: Number(ev.inner.toSeq) });
        }
      }
    } satisfies GeneratedRussh.ShellListener;

    try {
      const id = shell.addListener(listener, { cursor: cursorToGenerated(opts.cursor), coalesceMs: opts.coalesceMs });
      if (id === 0n) {
        throw new Error('Failed to attach shell listener (id=0)');
      }
      return BigInt(id);
    } catch (e) {
      throw new Error(`addListener failed: ${String((e as any)?.message ?? e)}`);
    }
  };

  return {
    channelId: info.channelId,
    createdAtMs: info.createdAtMs,
    pty: ptyEnumToLiteral[info.pty],
    connectionId: info.connectionId,
    sendData: (data, o) => shell.sendData(data, o?.signal ? { signal: o.signal } : undefined),
    close: (o) => shell.close(o?.signal ? { signal: o.signal } : undefined),
    setBufferPolicy,
    bufferStats,
    currentSeq: async () => Number(shell.currentSeq()),
    readBuffer,
    addListener,
    removeListener: (id) => shell.removeListener(id),
  };
}

function wrapConnection(conn: GeneratedRussh.SshConnectionInterface): SshConnection {
  const inf = conn.info();
  return {
    connectionId: inf.connectionId,
    connectionDetails: generatedConnDetailsToIdeal(inf.connectionDetails),
    createdAtMs: inf.createdAtMs,
    tcpEstablishedAtMs: inf.tcpEstablishedAtMs,
    startShell: async (params) => {
      const shell = await conn.startShell(
        {
          pty: ptyTypeLiteralToEnum[params.pty],
          onStatusChange: params.onStatusChange
            ? { onChange: (statusEnum) => params.onStatusChange!(sshConnStatusEnumToLiteral[statusEnum]) }
            : undefined,
        },
        params.abortSignal ? { signal: params.abortSignal } : undefined,
      );
      return wrapShellSession(shell);
    },
    disconnect: (opts) => conn.disconnect(opts?.signal ? { signal: opts.signal } : undefined),
  };
}

async function connect(options: ConnectOptions): Promise<SshConnection> {
  const security =
    options.security.type === 'password'
      ? new GeneratedRussh.Security.Password({ password: options.security.password })
      : new GeneratedRussh.Security.Key({ keyId: options.security.privateKey });
  const sshConnection = await GeneratedRussh.connect(
    {
      host: options.host,
      port: options.port,
      username: options.username,
      security,
      onStatusChange: options.onStatusChange ? {
        onChange: (statusEnum) => options.onStatusChange!(sshConnStatusEnumToLiteral[statusEnum])
      } : undefined,
    },
    options.abortSignal ? { signal: options.abortSignal } : undefined,
  );
  return wrapConnection(sshConnection);
}

async function generateKeyPair(type: 'rsa' | 'ecdsa' | 'ed25519') {
  const map = { rsa: GeneratedRussh.KeyType.Rsa, ecdsa: GeneratedRussh.KeyType.Ecdsa, ed25519: GeneratedRussh.KeyType.Ed25519 } as const;
  return GeneratedRussh.generateKeyPair(map[type]);
}


// #endregion

export const RnRussh = {
  uniffiInitAsync: GeneratedRussh.uniffiInitAsync,
  connect,
  generateKeyPair,
} satisfies RusshApi;
