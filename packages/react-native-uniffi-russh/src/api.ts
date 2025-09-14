/**
 * We cannot make the generated code match this API exactly because uniffi
 * - Doesn't support ts literals for rust enums
 * - Doesn't support passing a js object with methods and properties to rust
 * See: - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
 */
import * as GeneratedRussh from './index';


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

export type ConnectOptions = {
  onStatusChange?: (status: SshConnectionStatus) => void;
  abortSignal?: AbortSignal;
  host: string;
  port: number;
  username: string;
  security:
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string };
};

export type StartShellOptions = {
  pty: PtyType;
  onStatusChange?: (status: SshConnectionStatus) => void;
  abortSignal?: AbortSignal;
}

async function connect(options: ConnectOptions) {
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
          options.onStatusChange?.(sshConnStatusEnumToLiteral[statusEnum]!);
        },
      } : undefined,
    },
    options.abortSignal
      ? {
        signal: options.abortSignal,
      }
      : undefined
  );
  const originalStartShell = sshConnectionInterface.startShell;
  return {
    ...sshConnectionInterface,
    startShell: (params: StartShellOptions) => {
      return originalStartShell({
        pty: ptyTypeLiteralToEnum[params.pty],
        onStatusChange: params.onStatusChange ? {
          onChange: (statusEnum) => {
            params.onStatusChange?.(sshConnStatusEnumToLiteral[statusEnum]!);
          },
        } : undefined,
      }, params.abortSignal ? { signal: params.abortSignal } : undefined);
    }
  }
}

export type SshConnection = Awaited<ReturnType<typeof connect>>;

async function generateKeyPair(type: PrivateKeyType) {
  return GeneratedRussh.generateKeyPair(privateKeyTypeLiteralToEnum[type]);
}

export const RnRussh = {
  uniffiInitAsync: GeneratedRussh.uniffiInitAsync,
  connect,
  generateKeyPair,
  PtyType: GeneratedRussh.PtyType,
};
