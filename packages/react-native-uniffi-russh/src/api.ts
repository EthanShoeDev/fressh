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
	onServerKey: (
		serverKeyInfo: GeneratedRussh.ServerPublicKeyInfo,
		signal?: AbortSignal,
	) => Promise<boolean>;
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

export type CommandStreamEvent =
	| { type: 'stdout'; bytes: ArrayBuffer }
	| { type: 'stderr'; bytes: ArrayBuffer }
	| { type: 'exitStatus'; exitStatus: number }
	| { type: 'exitSignal'; signalName: string }
	| { type: 'closed' };

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
	runCommand: (
		opts: { command: string; maxOutputBytes?: number },
		asyncOpts?: { signal?: AbortSignal },
	) => Promise<CommandOutput>;
	startCommandStream: (
		opts: StartCommandStreamOptions,
	) => Promise<SshCommandStream>;
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
		opts?: { signal?: AbortSignal },
	) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;

	/**
	 * Resize the PTY window. Call when terminal UI size changes.
	 * Sends SSH "window-change" request to deliver SIGWINCH to remote process.
	 */
	resizePty: (
		cols: number,
		rows: number,
		opts?: { pixelWidth?: number; pixelHeight?: number; signal?: AbortSignal },
	) => Promise<void>;

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
		opts: ListenerOptions,
	) => bigint;
	removeListener: (id: bigint) => void;
};

export type SshCommandStream = {
	readonly channelId: number;
	readonly createdAtMs: number;
	readonly connectionId: string;
	sendData: (
		data: ArrayBuffer,
		opts?: { signal?: AbortSignal },
	) => Promise<void>;
	close: (opts?: { signal?: AbortSignal }) => Promise<void>;
};

export const DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES = Number(
	GeneratedRussh.defaultRunCommandMaxOutputBytes(),
);
export const MAX_RUN_COMMAND_MAX_OUTPUT_BYTES = Number(
	GeneratedRussh.maxRunCommandMaxOutputBytes(),
);

function maxOutputBytesToGenerated(maxOutputBytes: number | undefined) {
	if (maxOutputBytes === undefined) {
		return undefined;
	}
	if (!Number.isSafeInteger(maxOutputBytes)) {
		throw new Error('maxOutputBytes must be a safe integer');
	}
	if (maxOutputBytes <= 0) {
		throw new Error('maxOutputBytes must be greater than 0');
	}
	if (maxOutputBytes > MAX_RUN_COMMAND_MAX_OUTPUT_BYTES) {
		throw new Error(
			`maxOutputBytes must be at most ${MAX_RUN_COMMAND_MAX_OUTPUT_BYTES}`,
		);
	}
	return BigInt(maxOutputBytes);
}

type RusshApi = {
	uniffiInitAsync: () => Promise<void>;
	connect: (opts: ConnectOptions) => Promise<SshConnection>;
	generateKeyPair: (
		type: 'rsa' | 'ecdsa' | 'ed25519',
		// TODO: Add these
		// passphrase?: string;
		// keySize?: number;
		// comment?: string;
	) => Promise<string>;
	validatePrivateKey: (
		key: string,
	) =>
		| { valid: true; error?: never }
		| { valid: false; error: GeneratedRussh.SshError };
	extractPublicKey: (
		privateKey: string,
	) =>
		| { publicKey: string; error?: never }
		| { publicKey?: never; error: GeneratedRussh.SshError };
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
	details: GeneratedRussh.ConnectionDetails,
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
	shell: GeneratedRussh.ShellSessionInterface,
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
				`addListener failed: ${String((e as any)?.message ?? e)}`,
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
		resizePty: (cols, rows, o) =>
			shell.resizePty(
				cols,
				rows,
				o?.pixelWidth ?? undefined,
				o?.pixelHeight ?? undefined,
				o?.signal ? { signal: o.signal } : undefined,
			),
		// setBufferPolicy,
		bufferStats: shell.bufferStats,
		currentSeq: () => Number(shell.currentSeq()),
		readBuffer,
		addListener,
		removeListener: (id) => shell.removeListener(id),
	};
}

function toCommandStreamEvent(
	event: GeneratedRussh.CommandStreamEvent,
): CommandStreamEvent {
	if (event instanceof GeneratedRussh.CommandStreamEvent.Stdout) {
		return { type: 'stdout', bytes: event.inner.bytes };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.Stderr) {
		return { type: 'stderr', bytes: event.inner.bytes };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.ExitStatus) {
		return { type: 'exitStatus', exitStatus: event.inner.exitStatus };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.ExitSignal) {
		return { type: 'exitSignal', signalName: event.inner.signalName };
	}
	if (event instanceof GeneratedRussh.CommandStreamEvent.Closed) {
		return { type: 'closed' };
	}
	const exhaustive: never = event;
	throw new Error(`Unsupported command stream event: ${String(exhaustive)}`);
}

function wrapCommandStream(
	stream: GeneratedRussh.CommandStreamSessionInterface,
): SshCommandStream {
	const info = stream.getInfo();
	return {
		channelId: info.channelId,
		createdAtMs: info.createdAtMs,
		connectionId: info.connectionId,
		sendData: (data, opts) =>
			stream.sendData(data, opts?.signal ? { signal: opts.signal } : undefined),
		close: (opts) =>
			stream.close(opts?.signal ? { signal: opts.signal } : undefined),
	};
}

function wrapConnection(
	conn: GeneratedRussh.SshConnectionInterface,
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
					useTmux: params.useTmux,
					tmuxSessionName: params.tmuxSessionName,
				},
				params.abortSignal ? { signal: params.abortSignal } : undefined,
			);
			return wrapShellSession(shell);
		},
		runCommand: async ({ command, maxOutputBytes }, asyncOpts) => {
			const result = await conn.runCommand(
				{
					command,
					maxOutputBytes: maxOutputBytesToGenerated(maxOutputBytes),
				},
				asyncOpts?.signal ? { signal: asyncOpts.signal } : undefined,
			);
			return {
				stdout: result.stdout,
				stderr: result.stderr,
				exitStatus: result.exitStatus ?? null,
				exitSignal: result.exitSignal ?? null,
			};
		},
		startCommandStream: async ({ command, onEvent, abortSignal }) => {
			const stream = await conn.startCommandStream(
				{
					command,
					onEventCallback: {
						onEvent: (event) => onEvent(toCommandStreamEvent(event)),
					},
				},
				abortSignal ? { signal: abortSignal } : undefined,
			);
			return wrapCommandStream(stream);
		},
		disconnect: (opts) =>
			conn.disconnect(opts?.signal ? { signal: opts.signal } : undefined),
	};
}

async function connect({
	onServerKey,
	onConnectionProgress,
	onDisconnected,
	...options
}: ConnectOptions): Promise<SshConnection> {
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
			onConnectionProgressCallback: onConnectionProgress
				? {
						onChange: (statusEnum) =>
							onConnectionProgress(sshConnProgressEnumToLiteral[statusEnum]),
					}
				: undefined,
			onDisconnectedCallback: onDisconnected
				? {
						onChange: (connectionId) => onDisconnected(connectionId),
					}
				: undefined,
			onServerKeyCallback: {
				onChange: (serverKeyInfo) =>
					onServerKey(serverKeyInfo, options.abortSignal),
			},
		},
		options.abortSignal ? { signal: options.abortSignal } : undefined,
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
	key: string,
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

function extractPublicKey(
	privateKey: string,
):
	| { publicKey: string; error?: never }
	| { publicKey?: never; error: GeneratedRussh.SshError } {
	try {
		const publicKey = GeneratedRussh.extractPublicKey(privateKey);
		return { publicKey };
	} catch (e) {
		return { error: e as GeneratedRussh.SshError };
	}
}

// #endregion

export { SshError, SshError_Tags } from './generated/uniffi_russh';

export const RnRussh = {
	uniffiInitAsync: GeneratedRussh.uniffiInitAsync,
	connect,
	generateKeyPair,
	validatePrivateKey,
	extractPublicKey,
} satisfies RusshApi;
