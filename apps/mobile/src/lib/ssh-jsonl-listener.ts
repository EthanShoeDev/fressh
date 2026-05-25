// eslint-disable-next-line import/consistent-type-specifier-style -- keep Node integration tests from loading the native React Native package
import type {
	ListenerEvent,
	TerminalChunk,
} from '@fressh/react-native-uniffi-russh';
import { type RegisteredSshConnection } from './ssh-registry-store';

export const DEFAULT_SSH_JSONL_LISTENER_OPERATION_TIMEOUT_MS = 30_000;

export type SshJsonlListenerHandle = {
	stop: () => Promise<void>;
};

type ListenerShell = Awaited<ReturnType<RegisteredSshConnection['startShell']>>;

export async function startSshJsonlListener(input: {
	connection: RegisteredSshConnection;
	command: string;
	operationTimeoutMs?: number;
	onLine: (line: string) => void;
	onExit: (error?: unknown) => void;
}): Promise<SshJsonlListenerHandle> {
	const operationTimeoutMs =
		input.operationTimeoutMs ?? DEFAULT_SSH_JSONL_LISTENER_OPERATION_TIMEOUT_MS;
	let stopped = false;
	let listenerId: bigint | null = null;
	let shell: ListenerShell | null = null;

	const removeListener = () => {
		if (!shell || listenerId === null) return;
		try {
			shell.removeListener(listenerId);
		} catch (error) {
			console.warn('failed to remove JSONL listener', error);
		} finally {
			listenerId = null;
		}
	};

	const closeShellInstance = async (targetShell: ListenerShell) => {
		const controller = new AbortController();
		const closePromise = targetShell.close({ signal: controller.signal });
		try {
			await withOperationTimeout(closePromise, operationTimeoutMs, () => {
				controller.abort(listenerOperationTimeoutError());
			});
		} catch (error) {
			console.warn('failed to close JSONL listener shell', error);
		}
	};
	const closeShell = async () => {
		if (!shell) return;
		await closeShellInstance(shell);
	};

	const reportExit = (error?: unknown) => {
		if (stopped) return;
		stopped = true;
		removeListener();
		input.onExit(error);
	};
	const failListener = async (error: unknown) => {
		if (stopped) return;
		stopped = true;
		removeListener();
		await closeShell();
		input.onExit(error);
	};
	const handle: SshJsonlListenerHandle = {
		stop: async () => {
			if (stopped) return;

			stopped = true;
			removeListener();
			await closeShell();
		},
	};

	const startShellAbortController = new AbortController();
	const startShellPromise = input.connection.startShell({
		term: 'Xterm',
		useTmux: false,
		tmuxSessionName: '',
		onClosed: () => reportExit(),
		abortSignal: startShellAbortController.signal,
		registerInStore: false,
	});
	try {
		shell = await withOperationTimeout(
			startShellPromise,
			operationTimeoutMs,
			() => {
				startShellAbortController.abort(listenerOperationTimeoutError());
			},
		);
	} catch (error) {
		void startShellPromise
			.then((lateShell) => closeShellInstance(lateShell))
			.catch(() => {});
		throw error;
	}
	if (stopped) {
		await closeShell();
		return handle;
	}
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';

	try {
		listenerId = shell.addListener(
			(event) => {
				if (stopped || !isStdoutTerminalChunk(event)) return;

				buffer += decoder.decode(event.bytes, { stream: true });
				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						input.onLine(line);
					} catch (error) {
						void failListener(error);
						break;
					}
				}
			},
			{ cursor: { mode: 'live' } },
		);
	} catch (error) {
		stopped = true;
		await closeShell();
		throw error;
	}
	if (stopped) {
		removeListener();
		await closeShell();
		return handle;
	}

	try {
		const sendAbortController = new AbortController();
		const sendPromise = shell.sendData(
			encoder.encode(`exec ${input.command}\n`).buffer as ArrayBuffer,
			{ signal: sendAbortController.signal },
		);
		await withOperationTimeout(sendPromise, operationTimeoutMs, () => {
			sendAbortController.abort(listenerOperationTimeoutError());
		});
	} catch (error) {
		console.warn('failed to start JSONL listener command', error);
		if (!stopped) {
			stopped = true;
			removeListener();
			await closeShell();
			input.onExit(error);
		}
	}

	return handle;
}

function listenerOperationTimeoutError() {
	return new Error('SSH JSONL listener operation timed out');
}

async function withOperationTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					onTimeout();
					reject(listenerOperationTimeoutError());
				}, timeoutMs);
				const maybeNodeTimer = timeoutId as ReturnType<typeof setTimeout> & {
					unref?: () => void;
				};
				maybeNodeTimer.unref?.();
			}),
		]);
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function isTerminalChunk(event: ListenerEvent): event is TerminalChunk {
	return 'bytes' in event && 'stream' in event;
}

function isStdoutTerminalChunk(event: ListenerEvent): event is TerminalChunk {
	return isTerminalChunk(event) && event.stream === 'stdout' && !!event.bytes;
}
