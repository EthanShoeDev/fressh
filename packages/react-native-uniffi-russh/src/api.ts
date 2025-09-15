/**
 * We cannot make the generated code match this API exactly because uniffi
 * - Doesn't support ts literals for rust enums
 * - Doesn't support passing a js object with methods and properties to rust
 * See: - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
 */
import * as GeneratedRussh from './index';


// #region Ideal API

export type ConnectionDetails = {
  host: string;
  port: number;
  username: string;
  security:
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string };
};

export type ConnectOptions = ConnectionDetails & {
  onStatusChange?: (status: SshConnectionStatus) => void;
  abortSignal?: AbortSignal;
};

export type StartShellOptions = {
  pty: PtyType;
  onStatusChange?: (status: SshConnectionStatus) => void;
  abortSignal?: AbortSignal;
}
export type SshConnection = {
  connectionId: string;
  readonly createdAtMs: number;
  readonly tcpEstablishedAtMs: number;
  readonly connectionDetails: ConnectionDetails;
  startShell: (params: StartShellOptions) => Promise<SshShellSession>;
  addChannelListener: (listener: (data: ArrayBuffer) => void) => bigint;
  removeChannelListener: (id: bigint) => void;
  disconnect: (params?: { signal: AbortSignal }) => Promise<void>;
};

export type SshShellSession = {
  readonly channelId: number;
  readonly createdAtMs: number;
  readonly pty: GeneratedRussh.PtyType;
  readonly connectionId: string;
  sendData: (
    data: ArrayBuffer,
    options?: { signal: AbortSignal }
  ) => Promise<void>;
  close: (params?: { signal: AbortSignal }) => Promise<void>;
};


type RusshApi = {
  connect: (options: ConnectOptions) => Promise<SshConnection>;

  getSshConnection: (id: string) => SshConnection | undefined;
  getSshShell: (connectionId: string, channelId: number) => SshShellSession | undefined;
  listSshConnections: () => SshConnection[];
  listSshShells: () => SshShellSession[];
  listSshConnectionsWithShells: () => (SshConnection & { shells: SshShellSession[] })[];

  generateKeyPair: (type: PrivateKeyType) => Promise<string>;

  uniffiInitAsync: () => Promise<void>;
}

// #endregion

// #region Weird stuff we have to do to get uniffi to have that ideal API

const privateKeyTypeLiteralToEnum = {
  rsa: GeneratedRussh.KeyType.Rsa,
  ecdsa: GeneratedRussh.KeyType.Ecdsa,
  ed25519: GeneratedRussh.KeyType.Ed25519,
} as const satisfies Record<string, GeneratedRussh.KeyType>;
export type PrivateKeyType = keyof typeof privateKeyTypeLiteralToEnum;


const ptyTypeLiteralToEnum = {
  Vanilla: GeneratedRussh.PtyType.Vanilla,
  Vt100: GeneratedRussh.PtyType.Vt100,
  Vt102: GeneratedRussh.PtyType.Vt102,
  Vt220: GeneratedRussh.PtyType.Vt220,
  Ansi: GeneratedRussh.PtyType.Ansi,
  Xterm: GeneratedRussh.PtyType.Xterm,
  Xterm256: GeneratedRussh.PtyType.Xterm256,
} as const satisfies Record<string, GeneratedRussh.PtyType>;
export type PtyType = keyof typeof ptyTypeLiteralToEnum;


const sshConnStatusEnumToLiteral = {
  [GeneratedRussh.SshConnectionStatus.TcpConnecting]: 'tcpConnecting',
  [GeneratedRussh.SshConnectionStatus.TcpConnected]: 'tcpConnected',
  [GeneratedRussh.SshConnectionStatus.TcpDisconnected]: 'tcpDisconnected',
  [GeneratedRussh.SshConnectionStatus.ShellConnecting]: 'shellConnecting',
  [GeneratedRussh.SshConnectionStatus.ShellConnected]: 'shellConnected',
  [GeneratedRussh.SshConnectionStatus.ShellDisconnected]: 'shellDisconnected',
} as const satisfies Record<GeneratedRussh.SshConnectionStatus, string>;
export type SshConnectionStatus = (typeof sshConnStatusEnumToLiteral)[keyof typeof sshConnStatusEnumToLiteral];


function generatedConnDetailsToIdeal(details: GeneratedRussh.ConnectionDetails): ConnectionDetails {
  return {
    host: details.host,
    port: details.port,
    username: details.username,
    security: details.security instanceof GeneratedRussh.Security.Password ? { type: 'password', password: details.security.inner.password } : { type: 'key', privateKey: details.security.inner.keyId },
  };
}

function wrapConnection(conn: GeneratedRussh.SshConnectionInterface): SshConnection {
  // Wrap startShell in-place to preserve the UniFFI object's internal pointer.
  const originalStartShell = conn.startShell.bind(conn);
  const betterStartShell = async (params: StartShellOptions) => {
    const shell = await originalStartShell(
      {
        pty: ptyTypeLiteralToEnum[params.pty],
        onStatusChange: params.onStatusChange
          ? { onChange: (statusEnum) => params.onStatusChange?.(sshConnStatusEnumToLiteral[statusEnum]!) }
          : undefined,
      },
      params.abortSignal ? { signal: params.abortSignal } : undefined,
    );
    return wrapShellSession(shell);
  };

  // Accept a function for onData and adapt to the generated listener object.
  const originalAddChannelListener = conn.addChannelListener.bind(conn);
  const betterAddChannelListener = (listener: (data: ArrayBuffer) => void) =>
    originalAddChannelListener({ onData: listener });

  const connInfo = conn.info();
  return {
    connectionId: connInfo.connectionId,
    connectionDetails: generatedConnDetailsToIdeal(connInfo.connectionDetails),
    createdAtMs: connInfo.createdAtMs,
    tcpEstablishedAtMs: connInfo.tcpEstablishedAtMs,
    startShell: betterStartShell,
    addChannelListener: betterAddChannelListener,
    removeChannelListener: conn.removeChannelListener.bind(conn),
    disconnect: conn.disconnect.bind(conn),
  };
}

function wrapShellSession(shell: GeneratedRussh.ShellSessionInterface): SshShellSession {
  const info = shell.info();

  return {
    channelId: info.channelId,
    createdAtMs: info.createdAtMs,
    pty: info.pty,
    connectionId: info.connectionId,
    sendData: shell.sendData.bind(shell),
    close: shell.close.bind(shell)
  };
}

async function connect(options: ConnectOptions): Promise<SshConnection> {
  const security =
    options.security.type === 'password'
      ? new GeneratedRussh.Security.Password({
        password: options.security.password,
      })
      : new GeneratedRussh.Security.Key({ keyId: options.security.privateKey });
  const sshConnectionInterface = await GeneratedRussh.connect(
    {
      host: options.host,
      port: options.port,
      username: options.username,
      security,
      onStatusChange: options.onStatusChange ? {
        onChange: (statusEnum) => {
          const tsLiteral = sshConnStatusEnumToLiteral[statusEnum];
          if (!tsLiteral) throw new Error(`Invalid status enum: ${statusEnum}`);
          options.onStatusChange?.(tsLiteral);
        },
      } : undefined,
    },
    options.abortSignal
      ? {
        signal: options.abortSignal,
      }
      : undefined
  );
  return wrapConnection(sshConnectionInterface);
}

// Optional registry lookups: return undefined if not found/disconnected
function getSshConnection(id: string): SshConnection | undefined {
  try {
    const conn = GeneratedRussh.getSshConnection(id);
    return wrapConnection(conn);
  } catch {
    return undefined;
  }
}

function getSshShell(connectionId: string, channelId: number): SshShellSession | undefined {
  try {
    const shell = GeneratedRussh.getSshShell(connectionId, channelId);
    return wrapShellSession(shell);
  } catch {
    return undefined;
  }
}

function listSshConnections(): SshConnection[] {
  const infos = GeneratedRussh.listSshConnections();
  const out: SshConnection[] = [];
  for (const info of infos) {
    try {
      const conn = GeneratedRussh.getSshConnection(info.connectionId);
      out.push(wrapConnection(conn));
    } catch {
      // ignore entries that no longer exist between snapshot and lookup
    }
  }
  return out;
}

function listSshShells(): SshShellSession[] {
  const infos = GeneratedRussh.listSshShells();
  const out: SshShellSession[] = [];
  for (const info of infos) {
    try {
      const shell = GeneratedRussh.getSshShell(info.connectionId, info.channelId);
      out.push(wrapShellSession(shell));
    } catch {
      // ignore entries that no longer exist between snapshot and lookup
    }
  }
  return out;
}

/**
 * TODO: This feels a bit hacky. It is probably more effecient to do this join in rust and send 
 * the joined result to the app.
 */
function listSshConnectionsWithShells(): (SshConnection & { shells: SshShellSession[] })[] {
  const connections = listSshConnections();
  const shells = listSshShells();
  return connections.map(connection => ({
    ...connection,
    shells: shells.filter(shell => shell.connectionId === connection.connectionId),
  }));
}


async function generateKeyPair(type: PrivateKeyType) {
  return GeneratedRussh.generateKeyPair(privateKeyTypeLiteralToEnum[type]);
}

// #endregion

export const RnRussh = {
  uniffiInitAsync: GeneratedRussh.uniffiInitAsync,
  connect,
  generateKeyPair,
  getSshConnection,
  listSshConnections,
  listSshShells,
  listSshConnectionsWithShells,
  getSshShell,
} satisfies RusshApi;
