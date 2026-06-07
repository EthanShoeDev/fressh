jest.mock('../index', () => {
	class Password {
		inner: { password: string };
		constructor(inner: { password: string }) {
			this.inner = inner;
		}
	}

	class Key {
		inner: { privateKeyContent: string };
		constructor(inner: { privateKeyContent: string }) {
			this.inner = inner;
		}
	}

	class Stdout {
		inner: { bytes: ArrayBuffer };
		constructor(inner: { bytes: ArrayBuffer }) {
			this.inner = inner;
		}
	}

	class Stderr {
		inner: { bytes: ArrayBuffer };
		constructor(inner: { bytes: ArrayBuffer }) {
			this.inner = inner;
		}
	}

	class ExitStatus {
		inner: { exitStatus: number };
		constructor(inner: { exitStatus: number }) {
			this.inner = inner;
		}
	}

	class ExitSignal {
		inner: { signalName: string };
		constructor(inner: { signalName: string }) {
			this.inner = inner;
		}
	}

	class Closed {}

	return {
		CommandStreamEvent: {
			Stdout,
			Stderr,
			ExitStatus,
			ExitSignal,
			Closed,
		},
		Cursor: {
			Head: class {},
			TailBytes: class {
				constructor(_inner: { bytes: bigint }) {}
			},
			Seq: class {
				constructor(_inner: { seq: bigint }) {}
			},
			TimeMs: class {
				constructor(_inner: { tMs: number }) {}
			},
			Live: class {},
		},
		KeyType: {
			Rsa: 'Rsa',
			Ecdsa: 'Ecdsa',
			Ed25519: 'Ed25519',
		},
		Security: {
			Password,
			Key,
		},
		SshConnectionProgressEvent: {
			TcpConnected: 'TcpConnected',
			SshHandshake: 'SshHandshake',
		},
		StreamKind: {
			Stdout: 'Stdout',
			Stderr: 'Stderr',
		},
		TerminalType: {
			Vanilla: 'Vanilla',
			Vt100: 'Vt100',
			Vt102: 'Vt102',
			Vt220: 'Vt220',
			Ansi: 'Ansi',
			Xterm: 'Xterm',
			Xterm256: 'Xterm256',
		},
		defaultRunCommandMaxOutputBytes: () => 1024n * 1024n,
		maxRunCommandMaxOutputBytes: () => 16n * 1024n * 1024n,
		connect: jest.fn(),
		extractPublicKey: jest.fn(),
		generateKeyPair: jest.fn(),
		uniffiInitAsync: jest.fn(),
		validatePrivateKey: jest.fn(),
	};
});

const generated = jest.requireMock('../index');

import { MAX_RUN_COMMAND_MAX_OUTPUT_BYTES, RnRussh } from '../api';

type GeneratedCommandOutput = {
	stdout: ArrayBuffer;
	stderr: ArrayBuffer;
	exitStatus?: number | null;
	exitSignal?: string | null;
};

function bytes(text: string): ArrayBuffer {
	return Uint8Array.from([...text].map((char) => char.charCodeAt(0))).buffer;
}

function createGeneratedConnection(overrides: Record<string, unknown> = {}) {
	return {
		getInfo: () => ({
			connectionId: 'conn-1',
			connectionDetails: {
				host: 'example.test',
				port: 22,
				username: 'user',
				security: new generated.Security.Password({ password: 'pw' }),
			},
			createdAtMs: 1,
			connectedAtMs: 2,
			progressTimings: {
				tcpEstablishedAtMs: 3,
				sshHandshakeAtMs: 4,
			},
		}),
		startShell: jest.fn(),
		disconnect: jest.fn(),
		...overrides,
	};
}

async function connectWithGeneratedConnection(generatedConnection: unknown) {
	generated.connect.mockResolvedValueOnce(generatedConnection);
	return RnRussh.connect({
		host: 'example.test',
		port: 22,
		username: 'user',
		security: { type: 'password', password: 'pw' },
		onServerKey: async () => true,
	});
}

test('runCommand wrapper maps options, abort signal, output, and limits', async () => {
	const signal = new AbortController().signal;
	const runCommand: jest.Mock<
		Promise<GeneratedCommandOutput>,
		[unknown, unknown?]
	> = jest.fn(async (_input: unknown, _options?: unknown) => ({
		stdout: bytes('out'),
		stderr: bytes('err'),
	}));
	const connection = await connectWithGeneratedConnection(
		createGeneratedConnection({ runCommand }),
	);

	await expect(
		connection.runCommand({ command: 'printf test' }, { signal }),
	).resolves.toEqual({
		stdout: bytes('out'),
		stderr: bytes('err'),
		exitStatus: null,
		exitSignal: null,
	});
	expect(runCommand).toHaveBeenLastCalledWith(
		{ command: 'printf test', maxOutputBytes: undefined },
		{ signal },
	);

	await connection.runCommand({
		command: 'printf capped',
		maxOutputBytes: 4096,
	});
	expect(runCommand).toHaveBeenLastCalledWith(
		{ command: 'printf capped', maxOutputBytes: 4096n },
		undefined,
	);

	runCommand.mockResolvedValueOnce({
		stdout: bytes(''),
		stderr: bytes(''),
		exitStatus: 12,
		exitSignal: 'TERM',
	});
	await expect(
		connection.runCommand({ command: 'exit metadata' }),
	).resolves.toEqual({
		stdout: bytes(''),
		stderr: bytes(''),
		exitStatus: 12,
		exitSignal: 'TERM',
	});

	const successfulNativeCallCount = runCommand.mock.calls.length;
	await expect(
		connection.runCommand({ command: 'bad', maxOutputBytes: 1.5 }),
	).rejects.toThrow('safe integer');
	await expect(
		connection.runCommand({ command: 'bad', maxOutputBytes: 0 }),
	).rejects.toThrow('greater than 0');
	await expect(
		connection.runCommand({
			command: 'bad',
			maxOutputBytes: MAX_RUN_COMMAND_MAX_OUTPUT_BYTES + 1,
		}),
	).rejects.toThrow('at most');
	expect(runCommand).toHaveBeenCalledTimes(successfulNativeCallCount);
});

test('startCommandStream wrapper maps stream events, sendData, and close signal', async () => {
	const closeSignal = new AbortController().signal;
	const sendSignal = new AbortController().signal;
	let capturedCallback: { onEvent: (event: unknown) => void } | undefined;
	const sendData = jest.fn();
	const close = jest.fn();
	const startCommandStream = jest.fn(async (opts) => {
		capturedCallback = opts.onEventCallback;
		return {
			getInfo: () => ({
				channelId: 7,
				createdAtMs: 8,
				connectionId: 'conn-1',
			}),
			sendData,
			close,
		};
	});
	const events: unknown[] = [];
	const connection = await connectWithGeneratedConnection(
		createGeneratedConnection({ startCommandStream }),
	);

	const stream = await connection.startCommandStream({
		command: 'mdev events',
		onEvent: (event) => events.push(event),
		abortSignal: closeSignal,
	});

	expect(startCommandStream).toHaveBeenCalledWith(
		{
			command: 'mdev events',
			onEventCallback: expect.objectContaining({
				onEvent: expect.any(Function),
			}),
		},
		{ signal: closeSignal },
	);

	capturedCallback?.onEvent(
		new generated.CommandStreamEvent.Stdout({ bytes: bytes('out') }),
	);
	capturedCallback?.onEvent(
		new generated.CommandStreamEvent.Stderr({ bytes: bytes('err') }),
	);
	capturedCallback?.onEvent(
		new generated.CommandStreamEvent.ExitStatus({ exitStatus: 3 }),
	);
	capturedCallback?.onEvent(
		new generated.CommandStreamEvent.ExitSignal({ signalName: 'TERM' }),
	);
	capturedCallback?.onEvent(new generated.CommandStreamEvent.Closed());

	expect(events).toEqual([
		{ type: 'stdout', bytes: bytes('out') },
		{ type: 'stderr', bytes: bytes('err') },
		{ type: 'exitStatus', exitStatus: 3 },
		{ type: 'exitSignal', signalName: 'TERM' },
		{ type: 'closed' },
	]);
	expect(stream.channelId).toBe(7);
	expect(stream.createdAtMs).toBe(8);
	expect(stream.connectionId).toBe('conn-1');

	await stream.sendData(bytes('{"id":"hello-1","type":"hello"}\n'), {
		signal: sendSignal,
	});
	expect(sendData).toHaveBeenCalledWith(
		bytes('{"id":"hello-1","type":"hello"}\n'),
		{ signal: sendSignal },
	);

	await stream.close({ signal: closeSignal });
	expect(close).toHaveBeenCalledWith({ signal: closeSignal });
});
